const Alexa = require('ask-sdk-core');
const persistenceAdapter = require('ask-sdk-s3-persistence-adapter');
const Util = require('./util');
const Common = require('./common');

const DEFAULT_PERSISTENT_ATTRIBUTES = require('./default_attributes.json')

// The namespace of the custom directive to be sent by this skill
const NAMESPACE = 'Custom.Mindstorms.Gadget';

// The name of the custom directive to be sent this skill
const NAME_CONTROL = 'control';



// function to return the endpoint associated with the EV3 robot
const getEndpointID = async function (handlerInput) {
    // get the stored endpointId from the attributesManager
    const attributesManager = handlerInput.attributesManager;
    var endpointId = attributesManager.getSessionAttributes().endpointId || [];

    // if there is no stored endpointId, query the connected endpoints and store the new endpointId
    if (endpointId.length === 0) {
        const request = handlerInput.requestEnvelope;
        let { apiEndpoint, apiAccessToken } = request.context.System;
        let apiResponse = await Util.getConnectedEndpoints(apiEndpoint, apiAccessToken);
        if ((apiResponse.endpoints || []).length !== 0) {
            endpointId = apiResponse.endpoints[0].endpointId || [];
            Util.putSessionAttribute(handlerInput, 'endpointId', endpointId);
        }
    }
    return endpointId;
}

// this is called when the user says 'Alexa, open warehouse bot'
const LaunchRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
    },
    handle: async function (handlerInput) {

        // check for a connected EV3 brick
        const endpointId = getEndpointID(handlerInput);

        // speak an error message to the user if there is no EV3 brick connected
        if (endpointId.length === 0) {
            return handlerInput.responseBuilder
                .speak(`I couldn't find an EV3 Brick connected to this Echo device.`)
                .getResponse();
        }

        // speak a greeting to the user if there is a connected EV3 brick
        return handlerInput.responseBuilder
            .speak(`Welcome, you can start issuing commands`)
            .reprompt(`Awaiting commands`)
            .getResponse();
    }
};



// handles pickup intent requests
const PickupIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'PickupIntent';
    },
    handle: async function (handlerInput) {

        // get the variables in the intent request
        const request = handlerInput.requestEnvelope;
        const location = Alexa.getSlotValue(request, 'Location');
        const item = Alexa.getSlotValue(request, 'Item');

        // check for a connected EV3 brick
        const endpointId = await getEndpointID(handlerInput);

        // speak an error message to the user if there is no EV3 brick connected
        if (endpointId.length === 0) {
            return handlerInput.responseBuilder
                .speak(`I couldn't find an EV3 Brick connected to this Echo device`)
                .getResponse();
        }

        // get the manager for persistent attributes between sessions
        const attributesManager = handlerInput.attributesManager;
        var s3Attributes = await attributesManager.getPersistentAttributes() || {};
        if (Object.entries(s3Attributes).length === 0)
            s3Attributes = DEFAULT_PERSISTENT_ATTRIBUTES;
        console.log(JSON.stringify(s3Attributes));


        // return if already carrying a pallet
        if (s3Attributes.robot.carrying !== null) {
            return handlerInput.responseBuilder
                .speak(`The robot is already carrying a pallet. Tell the robot to deliver to a location first.`)
                .reprompt(`Awaiting command`)
                .getResponse();
        }

        // create an empty response object
        var response = handlerInput.responseBuilder;

        // get reference to pallet attributes in the persistent data
        var pallet = null;
        const pallets = s3Attributes.warehouse.pallets;

        // the user specified a certain item rather than from a location
        if (location === undefined) {
            // find the index of a pallet containing the requested item
            const index = pallets.findIndex((obj => obj.contents === item));

            if (index === -1) {
                // respond if there are no pallets containing the item requested
                response = response
                    .speak(`No pallets in the warehouse contain ${item}. Say another command.`)
                    .reprompt(`Awaiting command`);
            } else {

                // get the pallet with the item
                pallet = pallets[index];
                console.log(`${item} in pallet at ${pallet.location.replace('_', ' ')}`);

                // create a pickup directive to be sent to the EV3 robot
                // pass the current robot state, and desired pallet location
                const directive = Util.build(endpointId, NAMESPACE, NAME_CONTROL,
                    {
                        type: 'pickup',
                        state: s3Attributes.robot.state,
                        location: pallet.location,
                    });
                console.log(`Directive: ${JSON.stringify(directive)}`);

                // speak to user the status response, and send the directive
                response = response
                    .speak(`Picking up the ${item} from ${pallet.location.replace('_', ' ')}`)
                    .addDirective(directive);
            }

        } else {
            // the user specified a location rather than an item
            const location_fixed = location.replace(' ', '_');

            // find the index of the pallet at a location
            const index = pallets.findIndex((obj => obj.location === location_fixed));

            if (index === -1) {
                // respond if there are no pallets at the requested location
                response = response
                    .speak(`There is no pallet at ${location}. Say another command.`)
                    .reprompt(`Awaiting command`);
            } else {

                // get the pallet at the location
                pallet = pallets[index];

                // build a pickup directive to be sent to the EV3 robot
                const directive = Util.build(endpointId, NAMESPACE, NAME_CONTROL,
                    {
                        type: 'pickup',
                        state: s3Attributes.robot.state,
                        location: location_fixed,
                    });

                // speak to user the status response, and send the directive
                response = response
                    .speak((pallet.contents === null) ? `Picking up the empty pallet at ${location}` : `Picking up the ${pallet.contents} at ${location}`)
                    .addDirective(directive);
            }
        }

        // if the requested pallet was found, save the new states and locations in persistent storage
        if (pallet !== null) {
            console.log(`Saving robot state`);
            s3Attributes.robot.state = pallet.location;
            s3Attributes.robot.carrying = pallet.id;
            attributesManager.setPersistentAttributes(s3Attributes);
            await attributesManager.savePersistentAttributes();
        }

        return response.getResponse();
    }

};



// handle the drop intents
const DropIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'DropIntent';
    },
    handle: async function (handlerInput) {
        // get the slot values from the intent request
        const request = handlerInput.requestEnvelope;
        const location = Alexa.getSlotValue(request, 'Location');

        // get the endpoint of the EV3 robot
        const endpointId = await getEndpointID(handlerInput);
        console.log(`endpointId: ${JSON.stringify(endpointId)}`);

        // speak message if there is no EV3 device connected
        if (endpointId.length === 0) {
            return handlerInput.responseBuilder
                .speak(`I couldn't find an EV3 Brick connected to this Echo device`)
                .getResponse();
        }

        // get the persistent attributes
        const attributesManager = handlerInput.attributesManager;
        var s3Attributes = await attributesManager.getPersistentAttributes() || {};
        if (Object.entries(s3Attributes).length === 0)
            s3Attributes = DEFAULT_PERSISTENT_ATTRIBUTES;

        console.log(JSON.stringify(s3Attributes));

        // robot cannot drop a pallet if it is not carrying a pallet
        if (s3Attributes.robot.carrying === null) {
            return handlerInput.responseBuilder
                .speak(`The robot is not carrying a pallet. Say another command.`)
                .reprompt(`Awaiting command`)
                .getResponse();
        }

        const location_fixed = location.replace(' ', '_');
        console.log(`Checking for pallet already in ${location_fixed}`);
        const pallets = s3Attributes.warehouse.pallets;

        // find a pallet already at the location specified
        const index = pallets.findIndex((obj => (obj.location === location_fixed && obj.id !== s3Attributes.robot.carrying)));
        console.log(`Index of pallet: ${index}`);

        // cannot place a pallet if we found a pallet at the location we want to drop at
        if (index !== -1) {
            return handlerInput.responseBuilder
                .speak(`There is already a pallet in ${location}. Say another command.`)
                .reprompt(`Awaiting command`)
                .getResponse();
        }

        // get the pallet the robot is carrying, then update its location to where it will be dropped
        const carrying_index = pallets.findIndex((obj => (obj.id === s3Attributes.robot.carrying)));
        pallets[carrying_index].location = location_fixed;

        // create a drop directive to tell the robot to drop the pallet at the desired location
        const directive = Util.build(endpointId, NAMESPACE, NAME_CONTROL,
            {
                type: 'drop',
                state: s3Attributes.robot.state,
                location: location_fixed,
            });
        console.log(`Directive: ${JSON.stringify(directive)}`);

        // update the persistent warehouse data
        s3Attributes.robot.state = location_fixed;
        s3Attributes.robot.carrying = null;
        attributesManager.setPersistentAttributes(s3Attributes);
        await attributesManager.savePersistentAttributes();

        // speak the status message to the user, and send the directive to the robot
        return handlerInput.responseBuilder
            .speak(`Moving pallet to ${location}`)
            .addDirective(directive)
            .getResponse();
    }

};



// handle the move intent requests
const MoveIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'MoveIntent';
    },
    handle: async function (handlerInput) {
        // get the slot values from the intent request
        const request = handlerInput.requestEnvelope;
        const location = Alexa.getSlotValue(request, 'Location');

        // get the endpoint of the EV3 robot
        const endpointId = await getEndpointID(handlerInput);
        console.log(`endpointId: ${JSON.stringify(endpointId)}`);

        // speak message if there is no EV3 device connected
        if (endpointId.length === 0) {
            return handlerInput.responseBuilder
                .speak(`I couldn't find an EV3 Brick connected to this Echo device`)
                .getResponse();
        }

        // get the persistent attributes manager
        const attributesManager = handlerInput.attributesManager;
        var s3Attributes = await attributesManager.getPersistentAttributes() || {};
        if (Object.entries(s3Attributes).length === 0)
            s3Attributes = DEFAULT_PERSISTENT_ATTRIBUTES;
        console.log(JSON.stringify(s3Attributes));

        // if the robot is already at the location, tell the user
        const location_fixed = location.replace(' ', '_');
        if (s3Attributes.robot.state === location_fixed) {
            return handlerInput.responseBuilder
                .speak(`The robot is already at ${location}`)
                .reprompt(`Awaiting command`)
                .getResponse();
        }

        // create a movement directive to move the robot from its current state to the desired state
        const directive = Util.build(endpointId, NAMESPACE, NAME_CONTROL,
            {
                type: 'move',
                state: s3Attributes.robot.state,
                location: location_fixed,
            });

        // update the persistent warehouse data
        s3Attributes.robot.state = location_fixed;
        attributesManager.setPersistentAttributes(s3Attributes);
        await attributesManager.savePersistentAttributes();

        // speak the response to the user, and send the directive to the EV3 robot
        return handlerInput.responseBuilder
            .speak(`Moving to ${location}`)
            .addDirective(directive)
            .getResponse();
    }

};


// handle the set contents intents
const SetContentsIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'SetContentsIntent';
    },
    handle: async function (handlerInput) {
        // get slot values in the intent request
        const request = handlerInput.requestEnvelope;
        const item = Alexa.getSlotValue(request, 'Item');

        // get persistent data
        const attributesManager = handlerInput.attributesManager;
        var s3Attributes = await attributesManager.getPersistentAttributes() || {};
        if (Object.entries(s3Attributes).length === 0)
            s3Attributes = DEFAULT_PERSISTENT_ATTRIBUTES;
        console.log(JSON.stringify(s3Attributes));

        // empty speech output to make code cleaner
        var speechOutput = ``;

        // only allow setting the contents of the pallet the robot is carrying
        if (s3Attributes.robot.carrying === null) {
            speechOutput = `The robot is not currently carrying a pallet`
        } else {
            // get the pallet where the carrying flag is true
            const pallets = s3Attributes.warehouse.pallets;
            const index = pallets.findIndex((obj => obj.id === s3Attributes.robot.carrying));

            // set the contents to the specified item
            pallets[index].contents = item;

            // store the new warehouse data in persistent storage
            attributesManager.setPersistentAttributes(s3Attributes);
            await attributesManager.savePersistentAttributes();

            // respond with success message
            speechOutput = `Ok. This pallet now contains ${item}. Say another command.`;
        }

        // speak response to user
        return handlerInput.responseBuilder
            .speak(speechOutput)
            .reprompt(`Awaiting command`)
            .getResponse();
    }

};



// handle the search intents
const SearchIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'SearchIntent';
    },
    handle: async function (handlerInput) {
        // get slot values from the intent request
        const request = handlerInput.requestEnvelope;
        const item = Alexa.getSlotValue(request, 'Item');
        const location = Alexa.getSlotValue(request, 'Location');

        // get persistent attributes for the state of everything
        const attributesManager = handlerInput.attributesManager;
        var s3Attributes = await attributesManager.getPersistentAttributes() || {};
        if (Object.entries(s3Attributes).length === 0)
            s3Attributes = DEFAULT_PERSISTENT_ATTRIBUTES;
        console.log(JSON.stringify(s3Attributes));

        // setup speechOutput variable for cleaner code
        var speechOutput = ``;

        // the user is searching for an item, not the contents in a location
        if (location === undefined) {
            // get the pallets
            const pallets = s3Attributes.warehouse.pallets;

            // find a pallet with the desired contents
            const index = pallets.findIndex((obj => obj.contents === item));
            if (index === -1) {
                // none of the pallets contain the requested item
                speechOutput = `No pallets in the warehouse contain ${item}`;
            } else {
                // get the pallet
                const pallet = pallets[index];

                // respond with location of the pallet (carried by robot, or location in warehouse)
                if (pallet.id === s3Attributes.robot.carrying) {
                    speechOutput = `The robot is carrying the pallet of ${item}`;
                } else {
                    speechOutput = `The pallet containing ${item} is in ${pallet.location.replace('_', ' ')}`;
                }
            }
        } else {
            // the user is searching for the contents in a location
            const location_fixed = location.replace(' ', '_');
            const pallets = s3Attributes.warehouse.pallets;

            // get index of pallet at location
            const index = pallets.findIndex((obj => obj.location === location_fixed));
            if (index === -1) {
                // could not find pallet at location
                speechOutput = `There is no pallet in ${location}`;
            } else {
                // speak the contents of the pallet at the location
                const contents = pallets[index].contents;
                speechOutput = (contents === null) ? `The pallet in ${location} is empty` : `The ${contents} are in ${location}`;
            }
        }

        // speak the response to the user
        return handlerInput.responseBuilder
            .speak(speechOutput + `. Say another command.`)
            .reprompt(`Awaiting command`)
            .getResponse();
    }

};



// handle the reset intent
const ResetIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'ResetIntent';
    },
    handle: async function (handlerInput) {
        const request = handlerInput.requestEnvelope;

        // save the default persistent attributes to clear whatever attributes are currently there
        const attributesManager = handlerInput.attributesManager;
        attributesManager.setPersistentAttributes(DEFAULT_PERSISTENT_ATTRIBUTES);
        await attributesManager.savePersistentAttributes();

        // speak a response to the user
        return handlerInput.responseBuilder
            .speak(`Warehouse data reset. Say another command`)
            .reprompt(`Awaiting command`)
            .getResponse();
    }

};



// The SkillBuilder acts as the entry point for your skill, routing all request and response
// payloads to the handlers above. Make sure any new handlers or interceptors you've
// defined are included below. The order matters - they're processed top to bottom.
exports.handler = Alexa.SkillBuilders.custom()
    .withPersistenceAdapter(
        new persistenceAdapter.S3PersistenceAdapter({ bucketName: process.env.S3_PERSISTENCE_BUCKET })
    )
    .addRequestHandlers(
        LaunchRequestHandler,
        PickupIntentHandler,
        DropIntentHandler,
        MoveIntentHandler,
        SetContentsIntentHandler,
        SearchIntentHandler,
        ResetIntentHandler,
        Common.HelpIntentHandler,
        Common.CancelAndStopIntentHandler,
        Common.SessionEndedRequestHandler,
        Common.IntentReflectorHandler, // make sure IntentReflectorHandler is last so it doesn't override your custom intent handlers
    )
    .addRequestInterceptors(Common.RequestInterceptor)
    .addErrorHandlers(
        Common.ErrorHandler,
    )
    .lambda();