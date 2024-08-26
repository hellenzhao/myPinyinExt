/**
 * File: background.js
 * -------------------
 * Summary: Manages toggling of extension action and
 *  performs dictionary searches for chinese words (to send back to content).
 */

'use strict';
import {MyPy} from './mypy.js';


const mypy = new MyPy();

/* toggling of action enables/disables the extension */
chrome.action.onClicked.addListener(mypy.toggleIcon.bind(mypy));

/* updated and new tabs must be enabled when extension is already enabled */
chrome.tabs.onActivated.addListener( () => {
    let mode = mypy.enabled ? "enable" : "disable" 
    mypy.sendAllTabs({"type": mode});
});
chrome.tabs.onUpdated.addListener( () => {
    let mode = mypy.enabled ? "enable" : "disable" 
    mypy.sendAllTabs({"type": mode});
});

chrome.runtime.onMessage.addListener( (request, sender, callback) => {
    switch (request.type) {
        case 'search':
            let response = mypy.dict.lookUpWord(request.text);
            if (response) {
                response.originalText = request.originalText;
                response.selStartOffset = request.selStartOffset;
            }
            callback(response);
            break;
        default:
            console.log('Background received unknown request: ', request);
    } // maybe someday add cases for copy/add ?
})
