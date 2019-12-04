from enum import IntEnum
import time
from math import inf


# individual states the robot can be at (position and direction)
class State(IntEnum):
    ave1_0_e = 0
    ave1_0_s = 1
    ave1_0_w = 2

    ave1_1_n = 3
    ave1_1_e = 4
    ave1_1_s = 5
    ave1_1_w = 6

    ave1_2_n = 7
    ave1_2_e = 8
    ave1_2_s = 9
    ave1_2_w = 10

    ave1_3_n = 11
    ave1_3_e = 12
    ave1_3_s = 13
    ave1_3_w = 14

    ave1_4_n = 15
    ave1_4_e = 16
    ave1_4_s = 17
    ave1_4_w = 18

    ave1_5_n = 19
    ave1_5_e = 20
    ave1_5_s = 21
    ave1_5_w = 22

    ave1_6_n = 23
    ave1_6_e = 24
    ave1_6_s = 25
    ave1_6_w = 26

    ave1_7_n = 27
    ave1_7_e = 28
    ave1_7_s = 29
    ave1_7_w = 30

    # human-readible named locations for easier control
    start = 31
    slot_out = ave1_0_s
    slot_in = ave1_1_s
    slot_1 = ave1_2_w
    slot_2 = ave1_2_e
    slot_3 = ave1_3_w
    slot_4 = ave1_3_e
    slot_5 = ave1_4_w
    slot_6 = ave1_4_e
    slot_7 = ave1_5_w
    slot_8 = ave1_5_e
    slot_9 = ave1_6_w
    slot_10 = ave1_6_e
    slot_11 = ave1_7_w
    slot_12 = ave1_7_e


# the possible actions the robot can take while navigating
class ActionType(IntEnum):
    forward = 0
    left = 1
    right = 2


# a basic object to hold an action type and the number of repeats
class Action:
    def __init__(self, action_type, n=1):
        self.action_type = action_type
        self.n = n


# used to represent the action performed when moving from an initial state 's0' to a final state 's'
# invertible is an extra addition to make defining the trasition array easier
# (for most positions on the layout, turning right after turning left would be the inverse or opposite action)
class Transition:
    def __init__(self, s0, s, action, invertible=True):
        self.s0 = s0
        self.s = s
        self.action = action
        self.invertible = invertible

    # return the inverse transition if defined
    def inverse(self):
        # some transitions may specifically not be invertible depending on circumstances of the layout
        if not self.invertible:
            return None

        # opposite of turning left = turning right
        if self.action == ActionType.left:
            return Transition(self.s, self.s0, ActionType.right)

        # opposite of turning right = turning left
        elif self.action == ActionType.right:
            return Transition(self.s, self.s0, ActionType.left)
        return None

    # the cost of this transition to use when finding the shortest path between states
    def cost(self):
        # right now, each action costs the same amount, but if you had more complex layouts, the distance
        # between intersections could be factored in to find the actual least cost/time/distance path between states
        return 1


# class to handle all navigation commands and generate routes between states
class Navigator:
    def __init__(self, s):
        # transition array defined for the map on the hackster.io project
        # feel free to copy this same structure if you use a different layout

        # Transition(State.start, State.ave1_1_w, ActionType.forward) represents...
        # Execute 'forward' to get from 'start' to 'ave1_1_w'
        self.transitions = [
            Transition(State.start, State.ave1_1_w, ActionType.forward),
            Transition(State.ave1_1_w, State.ave1_1_n, ActionType.right),
            Transition(State.ave1_1_w, State.ave1_1_s, ActionType.left),
            Transition(State.ave1_1_w, State.ave1_0_w, ActionType.forward),
            Transition(State.ave1_1_e, State.ave1_1_n, ActionType.left),
            Transition(State.ave1_1_e, State.ave1_1_s, ActionType.right),
            Transition(State.ave1_1_n, State.ave1_2_n, ActionType.forward),

            # this transition is not ivertible because on this layout, turning right from ave1_0_s actually goes to ave1_0_e, not ave1_0_w because the line is shorter than the color sensor can detect
            Transition(State.ave1_0_w,
                       State.ave1_0_s,
                       ActionType.left,
                       invertible=False),
            Transition(State.ave1_0_s, State.ave1_0_e, ActionType.left),
            Transition(State.ave1_0_e, State.ave1_1_e, ActionType.forward),
            Transition(State.ave1_2_n, State.ave1_3_n, ActionType.forward),
            Transition(State.ave1_2_n, State.ave1_2_w, ActionType.left),
            Transition(State.ave1_2_n, State.ave1_2_e, ActionType.right),
            Transition(State.ave1_2_w, State.ave1_2_s, ActionType.left),
            Transition(State.ave1_2_e, State.ave1_2_s, ActionType.right),
            Transition(State.ave1_2_s, State.ave1_1_s, ActionType.forward),
            Transition(State.ave1_3_n, State.ave1_4_n, ActionType.forward),
            Transition(State.ave1_3_n, State.ave1_3_w, ActionType.left),
            Transition(State.ave1_3_n, State.ave1_3_e, ActionType.right),
            Transition(State.ave1_3_w, State.ave1_3_s, ActionType.left),
            Transition(State.ave1_3_e, State.ave1_3_s, ActionType.right),
            Transition(State.ave1_3_s, State.ave1_2_s, ActionType.forward),
            Transition(State.ave1_4_n, State.ave1_5_n, ActionType.forward),
            Transition(State.ave1_4_n, State.ave1_4_w, ActionType.left),
            Transition(State.ave1_4_n, State.ave1_4_e, ActionType.right),
            Transition(State.ave1_4_w, State.ave1_4_s, ActionType.left),
            Transition(State.ave1_4_e, State.ave1_4_s, ActionType.right),
            Transition(State.ave1_4_s, State.ave1_3_s, ActionType.forward),
            Transition(State.ave1_5_n, State.ave1_6_n, ActionType.forward),
            Transition(State.ave1_5_n, State.ave1_5_w, ActionType.left),
            Transition(State.ave1_5_n, State.ave1_5_e, ActionType.right),
            Transition(State.ave1_5_w, State.ave1_5_s, ActionType.left),
            Transition(State.ave1_5_e, State.ave1_5_s, ActionType.right),
            Transition(State.ave1_5_s, State.ave1_4_s, ActionType.forward),
            Transition(State.ave1_6_n, State.ave1_7_n, ActionType.forward),
            Transition(State.ave1_6_n, State.ave1_6_w, ActionType.left),
            Transition(State.ave1_6_n, State.ave1_6_e, ActionType.right),
            Transition(State.ave1_6_w, State.ave1_6_s, ActionType.left),
            Transition(State.ave1_6_e, State.ave1_6_s, ActionType.right),
            Transition(State.ave1_6_s, State.ave1_5_s, ActionType.forward),
            Transition(State.ave1_7_n, State.ave1_7_w, ActionType.left),
            Transition(State.ave1_7_n, State.ave1_7_e, ActionType.right),
            Transition(State.ave1_7_w, State.ave1_7_s, ActionType.left),
            Transition(State.ave1_7_e, State.ave1_7_s, ActionType.right),
            Transition(State.ave1_7_s, State.ave1_6_s, ActionType.forward),
        ]

        # generate the extra inverse transitions based on each transition already defined
        inv_transitions = []
        for t in self.transitions:
            inv = t.inverse()
            if inv is not None:
                inv_transitions.append(inv)

        # add the auto-generated inverse transitions to the transitions array
        self.transitions += inv_transitions

        # set the initial state
        self.state = s

    # returns the list of possible transitions from a state 's0' excluding those in the 'exclude' list
    def possible_transitions(self, s0, exclude=[]):
        ts = []
        for t in self.transitions:
            if t.s0 == s0 and t.s not in exclude:
                ts.append(t)
        return ts

    # generate the path to a desired state from the current state
    # based on Dijkstra's path finding algorithm
    def path_to(self, end_state):
        prev_action = None

        # initialize the weights of all nodes to infinity because they have not been visited (except for 0 for the current state because it costs nothing to remain where you are)
        n_states = len(set(State))
        visited = set()
        weights = {}
        for s in State:
            weights[s] = (inf, None) if s != self.state else (0, None)

        # iterate through the remaining unvisited states
        while len(visited) < n_states:
            # find the current lowest cost state
            s0 = None
            s0_w = inf
            for s in weights:
                if s not in visited:
                    if weights[s][0] < s0_w:
                        s0 = s
                        s0_w = weights[s][0]

            # 'visit' the lowest cost state
            visited.add(s0)

            # find all transitions from the lowest cost state
            for t in self.transitions:
                if t.s not in visited and t.s0 == s0:
                    w = s0_w + t.cost()
                    # only allow for reducing the cost of neighboring states
                    if w < weights[t.s][0]:
                        # update the cost of the neighboring state, and store which node the transition is from
                        weights[t.s] = (w, t)

        # iterate through the path in reverse order to find the sequence of moves
        s = end_state
        actions = []
        while s != self.state:
            # retrace the steps of Djikstra's path finding algorithm
            t = weights[s][1]
            if t is None:
                return None

            # get the action performed by the transition
            a = Action(t.action)

            # if there is already an action with the same type in the list, increase the number of repetitions rather than adding another action
            if len(actions) > 0 and actions[0].action_type == a.action_type:
                actions[0].n += 1
            else:
                # insert a new action
                actions.insert(0, a)

            # move backward along the path
            s = t.s0

        # return the final sequence of actions to get from state 's0' to state 's'
        return actions
