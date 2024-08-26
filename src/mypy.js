/**
 * File: mypy.js
 * -------------
 * Acts as a representation of the extension by
 * communicating to all tabs whether the extension is enabled/disabled
 * and loading the chinese dictionary.
 */
'use strict';

import {Dictionary} from "./dictionary.js";

export class MyPy {
    dict;
    constructor() {
        this.enabled = false;
    }
    
    async toggleIcon() { // service worker runs this when action clicked
        if (this.enabled) {
            this.enabled = false;
            delete this.dict;

            chrome.action.setIcon({ // turn icon off
                path: {
                    "16": "/icons/off-16.png",
                    "24": "/icons/off-24.png",
                    "32": "/icons/off-32.png",
                    "48": "/icons/off-48.png",
                    "128": "/icons/off-128.png"
                }
            });

            this.sendAllTabs({"type": "disable"});
        }
        else {
            if (!this.dict) {
                try {this.dict = new Dictionary(this);}
                catch (e) {alert('Error loading dictionary: ' + e);}
            }
            await this.dict.loadDict();
            this.enabled = true;

            chrome.action.setIcon({ // turn icon on
                path: {
                    "16": "/icons/on-16.png",
                    "24": "/icons/on-24.png",
                    "32": "/icons/on-32.png",
                    "48": "/icons/on-48.png",
                    "128": "/icons/on-128.png"
                }
            });

            this.sendAllTabs({"type": "enable"});
        }
    }

    async sendAllTabs(message) {
        let tabs = await chrome.tabs.query({});

        tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, message);
        })
    }

}