import time
import json
from math import *

# import the navigation functions for the robot
from navigation import *

# import the Alexa Gadgets Toolkit so the robot can communicate with an Alexa device
from agt import AlexaGadget

# import the required libraries to interface with the EV3 hardware components
from ev3dev2.motor import LargeMotor, MediumMotor
from ev3dev2.sensor.lego import ColorSensor, InfraredSensor
from ev3dev2.led import Leds


# a basic class to handle PID control behavior
class PID:
    kp, kd = 0, 0
    e0 = 0

    def __init__(self, kp=0, kd=0):
        self.kp = kp
        self.kd = kd

    def calculate(self, e):
        v = self.kp * e + (e - self.e0) * self.kd
        self.e0 = e
        return v


# an enum to define the state of the lifter
class LiftState(IntEnum):
    up = 0
    down = 1


# main class that handles all of the robot behaviors controlled through the Alexa Skill
class Robot(AlexaGadget):
    def __init__(self):
        super().__init__()

        # initialize all of the motors
        print('Initializing devices')
        self.leds = Leds()
        self.motor_left = LargeMotor(address='outA')
        self.motor_right = LargeMotor(address='outD')
        self.motor_lift = MediumMotor(address='outC')
        self.motor_left.off(brake=False)
        self.motor_right.off(brake=False)
        self.motor_lift.off(brake=False)

        # rotate the robot ~45 degrees off the path so the color sensor has a white background for calibration
        turn_distance = 0.75
        self.motor_left.on_for_rotations(20, turn_distance, block=False)
        self.motor_right.on_for_rotations(20, -turn_distance)

        # initialize the color sensor for following the line
        self.sensor_color = ColorSensor()
        self.sensor_color.mode = self.sensor_color.MODE_RGB_RAW
        self.sensor_color.calibrate_white()

        # rotate the robot back to its original position before calibrating the color sensor
        self.motor_left.on_for_rotations(20, -turn_distance, block=False)
        self.motor_right.on_for_rotations(20, turn_distance)

        # initialize the IR sensor for finding the home position of the lift
        self.sensor_infrared = InfraredSensor()
        self.sensor_infrared.mode = self.sensor_infrared.MODE_IR_PROX

        # run the lift calibration routine so the robot knows where the lifter is on startup
        print('Calibrating lift')
        self.calibrate_lift()

        # setup the navigation controlled and the line-following PID controller
        print('Initializing navigation')
        self.nav = Navigator(State.start)
        self.line_PID = PID(kp=1.5, kd=2)

    # called when the EV3 brick connects to an Alexa device
    def on_connected(self, device_addr):
        self.leds.set_color('LEFT', 'GREEN')
        self.leds.set_color('RIGHT', 'GREEN')
        print("{} connected to Echo device".format(self.friendly_name))

    # called when the EV3 brick disconnects from an Alexa device
    def on_disconnected(self, device_addr):
        self.leds.set_color('LEFT', 'BLACK')
        self.leds.set_color('RIGHT', 'BLACK')
        print("{} disconnected from Echo device".format(self.friendly_name))

    # the function called to receive gadget control directives from the Alexa Skill through the connected Alexa device
    def on_custom_mindstorms_gadget_control(self, directive):
        # decode the directive payload into a JSON object
        payload = json.loads(directive.payload.decode("utf-8"))
        print("Control payload: {}".format(payload))

        # determine which command to be executed
        control_type = payload['type']
        if control_type == 'pickup':
            # get the source and destination states for this command
            src_state = State[payload['state']]
            dst_state = State[payload['location']]

            # raise the lift if the robot needs to move
            if not dst_state == src_state:
                self.set_lift(LiftState.up)

            # set the robot's current state to the state passed from the Alexa skill so the robot can be commanded even after the program is restarted.
            # (Alexa skill has persistent storage of all the state information for crates and the robot)
            self.nav.state = src_state

            # use the navigation system to follow a path to the destination.
            self.move_to(dst_state)

            # this routine follows the line slowly to pickup a pallet in front of it
            self.set_lift(LiftState.down)
            self.move_forward(speed=0.2)
            self.set_lift(LiftState.up)
            self.move_back(speed=0.2)

        elif control_type == 'drop':
            # get the source and destination states for this command
            src_state = State[payload['state']]
            dst_state = State[payload['location']]

            # set the robot's current state to the state passed from the Alexa skill so the robot can be commanded even after the program is restarted.
            self.nav.state = src_state

            # make sure the lift is raised before navigating to the destination state
            self.set_lift(LiftState.up)
            self.move_to(dst_state)

            # this routine follows the line slowly, lowers the lift, then backs up to the starting point
            self.move_forward(speed=0.2)
            self.set_lift(LiftState.down)
            self.move_back(speed=0.2)
            self.set_lift(LiftState.up)

        elif control_type == 'move':
            # get the source and destination states for this command
            src_state = State[payload['state']]
            dst_state = State[payload['location']]

            # make sure the lift is raised before navigating to the destination state
            self.set_lift(LiftState.up)

            # execute a basic move command
            self.nav.state = src_state
            self.move_to(dst_state)

    # a high-level movement command to navigate the robot on a path to a desired state
    def move_to(self, state):
        # generate the set of actions required to navigate from the current state to the destination state
        actions = self.nav.path_to(state)

        # if there is no valid path, or the robot is already at the destination state, the command has been completed
        if actions is None:
            return

        # loop through and run the required actions in order
        for a in actions:
            print(a.action_type.name, a.n)

            # check what type the action is, then run the necessary command to perform the action
            # a.n represents the number of times an action will be repeated... ActionType.forward and n=2 would mean move forward two times
            if a.action_type == ActionType.forward:
                self.move_forward(num=a.n)
            elif a.action_type == ActionType.left:
                self.move_turn(num=a.n, right=False)
            elif a.action_type == ActionType.right:
                self.move_turn(num=a.n, right=True)

        # set the robot's current state to the destination state for good measure
        self.nav.state = state

    # this function executes a forward movement command
    # 'num' represents how many intersections to pass through
    # 'speed' represents how fast to move 0-1
    def move_forward(self, num=1, speed=0.3):
        in_intersection = False

        # loop through repeated moves until there are no more moves to execute
        while num > 0:
            # get the green and blue channels of the color sensor for line-following
            # there is just enough space between the green and blue sensors to detect both sides of the line
            _, g, b = self.sensor_color.rgb

            # if the robot is not in an intersection, and both channels are dark, the robot must be in an intersection.
            if not in_intersection and g < 110 and b < 110:
                print('hit intersection')
                in_intersection = True
                # decrease the number of remaining moves
                num -= 1
            elif in_intersection and g > 110 and b > 110:
                # if the robot was in an intersection, but both channels are now light, the robot has left the intersection
                in_intersection = False
            else:
                # find the difference in brightness between the left and right sides of the line
                line_dif = (g - b) / 1000

                # determine the amount to steer based on the PID controller
                steering = self.line_PID.calculate(line_dif)

                # generate the speeds for each motor based on the forward speed, and the steering amount
                left = -min(max(-1, speed + steering), 1)
                right = -min(max(-1, speed - steering), 1)
                self.motor_left.on(round(left * 100))
                self.motor_right.on(round(right * 100))

        # the loop will exit immediately when the robot exits the intersection
        # the robot needs to "roll past" the intersection a small amount so the wheels are more in-line with the grid
        # (the color sensor is a couple cm in front of the axle line)
        roll_past = -0.65
        self.motor_left.on_for_rotations(round(speed * 100),
                                         roll_past,
                                         block=False)
        self.motor_right.on_for_rotations(round(speed * 100), roll_past)

    # this function executes a turns
    # 'num' represents how many paths to turn past at an intersection
    # 'right' represents direction to turn (True = turn right, False = turn left)
    # 'speed' represents the speed to turn the robot at
    def move_turn(self, num=1, right=True, speed=0.2):
        # repeat the command in a loop so consecutive turns are run smoothly
        while num > 0:
            # the state variable for a single turn movement
            state = 0
            while True:
                # get the green and blue channels of the color sensor for line-detection
                _, g, b = self.sensor_color.rgb

                # choose the outside channel to detect passing over the line
                light_value = g if right else b

                # beginning of the turn (robot was centered on the line and the outside color channel should get darker as it passes over the line)
                if state == 0:
                    # when the outside color channel goes high, the robot has turned past the first line, and now needs to detect when another line appears
                    if light_value > 220:
                        state = 1

                # the robot is between two lines and waiting until it turns onto the next line
                elif state == 1:
                    # the color channel which was previously light, has now gone dark, meaning the robot has completed one turn
                    if light_value < 180:
                        # decrease the number of remaining turns, and repeat the process again
                        num -= 1
                        break

                # tell motors to move in opposite directions at the desired speed
                speed_scalar = 1 if right else -1
                self.motor_left.on(round(-speed_scalar * speed * 100))
                self.motor_right.on(round(speed_scalar * speed * 100))

        # turn off the motors at the end of the set of turns so there is no annoying high-frequency humming
        self.motor_left.off()
        self.motor_right.off()

    # move the robot straight back at a certain speed for a certain number of rotations
    def move_back(self, speed=0.2, distance=1.6):
        self.motor_left.on_for_rotations(round(speed * 100),
                                         distance,
                                         block=False)
        self.motor_right.on_for_rotations(round(speed * 100), distance)

    # lift calibration procedure
    def calibrate_lift(self):
        # set the lift motor to move up at 10% speed
        self.motor_lift.on(-10)

        # wait until the IR sensor detects the forklift in front of it
        while self.sensor_infrared.proximity >= 70:
            pass

        # set the robot's internal lift-state to 'up'
        self.lift_state = LiftState.up

        # lower the lift
        self.set_lift(LiftState.down)

    # a controlled function to ensure proper lift control (don't allow raising it even more if the lift is already up...)
    def set_lift(self, state):
        # ensure the lift is not already in the desired position
        if state != self.lift_state:
            if state == LiftState.up:
                # if the lift needs to be raised, turn the motor just the right amount
                self.motor_lift.on_for_rotations(10, -0.5)
                # DO NOT turn off the motor because it is probably holding some weight on the forklift
            elif state == LiftState.down:
                # if the lift needs to be lowered, turn the motor just the right amount to be just above the ground
                self.motor_lift.on_for_rotations(10, 0.5)
                # turn off the motor to reduce annoying buzzing
                self.motor_lift.off()

            # set the robot's internal lift state for safe control
            self.lift_state = state

    # turn off all motors and lights
    def poweroff(self):
        self.motor_left.off(brake=False)
        self.motor_right.off(brake=False)
        self.motor_lift.off(brake=False)
        self.leds.set_color('LEFT', 'BLACK')
        self.leds.set_color('RIGHT', 'BLACK')


# called at program startup
def main():
    # create a robot instance
    robot = Robot()

    # run the main function to handle Alexa Gadget code
    robot.main()

    # poweroff after the execution has been completed (or program exited)
    robot.poweroff()


if __name__ == '__main__':
    main()
