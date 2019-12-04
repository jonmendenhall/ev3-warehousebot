/*
 * Copyright 2019 Amazon.com, Inc. or its affiliates.  All Rights Reserved.
 *
 * You may not use this file except in compliance with the terms and conditions 
 * set forth in the accompanying LICENSE.TXT file.
 *
 * THESE MATERIALS ARE PROVIDED ON AN "AS IS" BASIS. AMAZON SPECIFICALLY DISCLAIMS, WITH 
 * RESPECT TO THESE MATERIALS, ALL WARRANTIES, EXPRESS, IMPLIED, OR STATUTORY, INCLUDING 
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
*/

'use strict';

const Https = require('https');

/**
 * Build a custom directive payload to the gadget with the specified endpointId
 * @param {string} endpointId - the gadget endpoint Id
 * @param {string} namespace - the namespace of the skill
 * @param {string} name - the name of the skill within the scope of this namespace
 * @param {object} payload - the payload data
 * @see {@link https://developer.amazon.com/docs/alexa-gadgets-toolkit/send-gadget-custom-directive-from-skill.html#respond}
 */
exports.build = function (endpointId, namespace, name, payload) {
    // Construct the custom directive that needs to be sent
    // Gadget should declare the capabilities in the discovery response to
    // receive the directives under the following namespace.
    return {
        type: 'CustomInterfaceController.SendDirective',
        header: {
            name: name,
            namespace: namespace
        },
        endpoint: {
            endpointId: endpointId
        },
        payload
    };
};

/**
 * A convenience routine to add the a key-value pair to the session attribute.
 * @param handlerInput - the context from Alexa Service
 * @param key - the key to be added
 * @param value - the value be added
 */
exports.putSessionAttribute = function(handlerInput, key, value) {
    const attributesManager = handlerInput.attributesManager;
    let sessionAttributes = attributesManager.getSessionAttributes();
    sessionAttributes[key] = value;
    attributesManager.setSessionAttributes(sessionAttributes);
};

/**
 * To get a list of all the gadgets that meet these conditions,
 * Call the Endpoint Enumeration API with the apiEndpoint and apiAccessToken to
 * retrieve the list of all connected gadgets.
 *
 * @param {string} apiEndpoint - the Endpoint API url
 * @param {string} apiAccessToken  - the token from the session object in the Alexa request
 * @see {@link https://developer.amazon.com/docs/alexa-gadgets-toolkit/send-gadget-custom-directive-from-skill.html#call-endpoint-enumeration-api}
 */
exports.getConnectedEndpoints = function(apiEndpoint, apiAccessToken) {

    // The preceding https:// need to be stripped off before making the call
    apiEndpoint = (apiEndpoint || '').replace('https://', '');
    return new Promise(((resolve, reject) => {

        const options = {
            host: apiEndpoint,
            path: '/v1/endpoints',
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiAccessToken
            }
        };

        const request = Https.request(options, (response) => {
            response.setEncoding('utf8');
            let returnData = '';
            response.on('data', (chunk) => {
                returnData += chunk;
            });

            response.on('end', () => {
                resolve(JSON.parse(returnData));
            });

            response.on('error', (error) => {
                reject(error);
            });
        });
        request.end();
    }));
};