/**
 * File: content.js
 * -----------------
 * Summary: Listens for messages from background to enable 
 * (listen for mouse movement), disable (stop listening), or show popup.
 * 
 * Details: Mouse movement fires onMouseMove, which gets the hovered text and position,
 * messages the background to search for word matches, then processes this to
 * highlight text and make the popup html.
*/

'use strict';

let savedTarget;
let savedTextNode;
let savedOffset;

let selText;

let popupX = 0;
let popupY = 0;

let timer; // to track how long mouse is still (only popup if > 50 ms)

let savedSearchResults = []; // might use for copying
let savedSelEndList = [];

let zwnj = /\u200c/g; // regular expression for zero-width non-joiner U+200C &zwnj;


function enableTabs() { // on: hovering highlights word and triggers popup
    document.addEventListener('mousemove', onMouseMove);
}

function disableTabs() { // off: don't highlight or popup
    document.removeEventListener('mousemove', onMouseMove);

    let popup = document.getElementById('popup-window');
    if (popup) {
        popup.parentNode.removeChild(popup);
    }

    clearHighlight();
}


/**
 * Determines if mouse has changed location and hovered there for > 50 ms.
 * If so, find the node and offset of the hovered over text, and call
 * makeSearch (which will retrieve the data to display in the popup).
 * 
 * @listens MouseEvent
 * @param {MouseEvent} mouseMove
*/
function onMouseMove(mouseMove) {
    let range, textNode, offset;

    if (document.caretPositionFromPoint) {
        range = document.caretPositionFromPoint(mouseMove.clientX, mouseMove.clientY);
        if (range === null) {return;}
        textNode = range.offsetNode;
        offset = range.offset;
    }
    else if (document.caretRangeFromPoint) { // deprecated but works for chrome?
        range = document.caretRangeFromPoint(mouseMove.clientX, mouseMove.clientY);
        if (range === null) {return;}
        textNode = range.startContainer;
        offset = range.startOffset;
    }
    else {
        console.log("Neither caretPositionFromPoint nor caretRangeFromPoint supported");
        return;
    }

    if (mouseMove.target === savedTarget &&
            textNode === savedTextNode && offset === savedOffset) { // no change
        return;
    }

    if (timer) { // if mouse moves before 50 ms, cancel makeSearch
        clearTimeout(timer);
        timer = null;
    }

    // If the offset equals the text length, we actually want the next textNode
    if (textNode && textNode.data && offset === textNode.data.length) {
        textNode = findNextTextNode(textNode.parentNode, textNode);
        offset = 0;
    }
    if (!textNode || textNode.parentNode !== mouseMove.target) {
        // someday deal w/ mouseMove.target.nodeName === 'TEXTAREA' or 'INPUT' case
        textNode = null;
        offset = -1;
    }

    savedTarget = mouseMove.target;
    savedTextNode = textNode;
    savedOffset = offset;

    if (textNode && textNode.data && offset < textNode.data.length) {
        popupX = mouseMove.clientX;
        popupY = mouseMove.clientY;
        timer = setTimeout(() => {makeSearch()}, 50);
        return;
    }

    // Don't close if we only moved slightly from a valid popup to a place with nothing.
    let dx = popupX - mouseMove.clientX;
    let dy = popupY - mouseMove.clientY;
    let distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > 4) {
        clearHighlight();
        hidePopup();
    }
}

/**
 * If the currently saved text node and starting offset is valid,
 * get the first 10 characters at the offset and send this text to the background.
 * 
 * @fires onMessage
 * @returns {int} An int representing either a successful search or a failed case.
 */
function makeSearch() {
    let textNode = savedTextNode;
    let selStartOffset = savedOffset;

    if (!textNode) {
        clearHighlight();
        hidePopup();
        return 1;
    }

    if (selStartOffset < 0 || textNode.data.length <= selStartOffset) {
        clearHighlight();
        hidePopup();
        return 2;
    }

    let selEndList = [];
    let originalText = getText(textNode, selStartOffset, selEndList);

    let text = originalText.replace('&zwnj', ''); // workaround for g docs (remove &zwnj;)

    savedSelEndList = selEndList;

    chrome.runtime.sendMessage({
            'type': 'search',
            'text': text,
            'originalText': originalText,
            'selStartOffset': selStartOffset
        },
        processSearchResult
    );

    return 0;
}


/**
 * Determines length of text to be highlighted, then calls
 * highlightMatch, makeHtml, and showPopup.
 * 
 * @param {Object} result Result of Dictionary word look up sent by service worker.
 * Properties: data (list of matching map entries), matchLen (character length of longest match).
 * 
 * @returns void
 */
function processSearchResult(result) {
    if (!result || result.data.length === 0) {
        hidePopup();
        clearHighlight();
        return;
    }

    let selStartOffset = result.selStartOffset;
    let selEndList = savedSelEndList;

    let highlightLength = 0;
    for (let i = 0; i < result.matchLen; i++) {
        while (result.originalText && result.originalText[highlightLength] === '\u200c') {
            highlightLength++;
        } // g. docs workaround to determine correct length
        highlightLength++;
    }

    let textNode = savedTextNode;
    if (!('form' in savedTarget)) { // highlight unless it's a form element
        let doc = textNode.ownerDocument;
        if (!doc) {
            clearHighlight();
            hidePopup();
            return;
        }
        highlightMatch(doc, textNode, selStartOffset, highlightLength, selEndList);
    }
    showPopup(makeHtml(result), savedTarget, popupX, popupY);
}


/**
 * Constructs the html for the popup, with each popup entry providing
 *  the highlighted/hovered word in simplified, traditional, pinyin, and definition form.
 * 
 * @param {Object} matches Resulting matches from dictionary word lookup sent by background.
 *  Properties: data (a list of (simplified, traditional, pinyin, definition) entry matches),
 *  matchLen (maximum character length of the matches).
 * @returns {string} Returns as a string the html for the popup.
 */
function makeHtml(matches) {
    if (matches == null) {return '';}

    let simplified, traditional, pinyin, definition;
    let html = '';

    html += '<div class="popup-container">';

    for (let i = 0; i < matches.data.length; i++) {
        simplified = matches.data[i].simplified;
        traditional = matches.data[i].traditional;
        pinyin = matches.data[i].pinyin;
        definition = defHtml(matches.data[i].definition);

        let diff_trad = '';
        for (let k = 0; k < simplified.length; k++) {
            if (simplified[k] === traditional[k]) {diff_trad += '\u30FB';}
            else {diff_trad += traditional[k];}
        }

        html += '<div class="entry">';

        html += '<div class="chinese">';
        html += '<span>' + simplified + '</span>' + 
                '<span class="spacer"></span>' +
                '<span> <span class="brace">[</span>' + diff_trad + '<span class="brace">]</span> </span>';
        html += '</div>' // close chinese div

        html += '<div class="pinyin">';
        html += '<span>' + pinyin + '</span>';
        html += '</div>'; // close pinyin div

        html += '<div class="def">' + definition + '</div>';

        html += '</div>'; // close entry div
    }
    return html;
}


/**
 * Creates the popup if it doesn't exit, sets the html content,
 *  determines the popup location, and makes the popup visible.
 * 
 * @param {string} html The html for the popup as a string.
 * @param {Element} elem The target element that the mouse is hovering over.
 * @param {int} x The x-coordinate for the popup.
 * @param {int} y The y-coordinate for the popup.
 */
function showPopup(html, elem, x, y) {
    if (!x || !y) {
        x = y = 0;
    }

    let popup = document.getElementById('popup-window');

    if (!popup) {
        popup = document.createElement('div');
        popup.setAttribute('id', 'popup-window');
        document.documentElement.appendChild(popup);
    }

    popup.innerHTML = html; // set html content as html

    if (elem) {
        popup.style.top = '-1000px';
        popup.style.left = '0px';
        popup.style.display = '';

        let v = 25; // popup will be 25 vertically below mouse
        let pW = popup.offsetWidth;
        let pH = popup.offsetHeight;

        if (pW <= 0) {pw = 200;}
        if (pH <= 0) {
            pH = 25;
            let j = 0;
            while ((j = html.indexOf('<br/>', j)) !== -1) {
                j += 5;
                pH += 22;
            }
        }

        if (x + pW > window.innerWidth - 20) { // go left if necessary
            x = (window.innerWidth - pW) - 20;
            if (x < 0) {
                x = 0;
            }
        }
        if (y + v + pH > window.innerHeight) { // go up if necessary
            let t = y - pH - 30;
            if (t >= 0) {
                y = t;
            }
            else {
                y += v;
            }
        }
        else  {
            y += v;
        }
    }
    x += window.scrollX; // account for scrolling
    y += window.scrollY;

    if (x !== -1 && y !== -1) { // (-1, -1) indicates unchanged
        popup.style.left = x + 'px';
        popup.style.top = y + 'px';
        popup.style.display = '';
    }
}

function hidePopup() { // set popup to be invisible and without text
    let popup = document.getElementById('popup-window');
    if (popup) {
        popup.style.display = 'none';
        popup.textContent = '';
    }
}


/**
 * Highlights the longest dictionary match within the moused over text.
 * 
 * @param {Document} doc The owner document of the mouse event target.
 * @param {*} rangeStartNode The text node containing the first character of the moused over text.
 * @param {*} rangeStartOffset The offset of the first moused over character in rangeStartNode.
 * @param {*} matchLen The length of text to highlight.
 * @param {*} selEndList The list of (node, offset) entries that gives the nodes containing the text.
 * @returns void
 */
function highlightMatch(doc, rangeStartNode, rangeStartOffset, matchLen, selEndList) {
    if (!selEndList || selEndList.length === 0) return;

    let selEnd;
    let offset = rangeStartOffset + matchLen;

    for (let i = 0, len = selEndList.length; i < len; i++) {
        selEnd = selEndList[i];
        if (offset <= selEnd.offset) {
            break;
        }
        offset -= selEnd.offset;
    }

    let range = doc.createRange();
    range.setStart(rangeStartNode, rangeStartOffset);
    range.setEnd(selEnd.node, offset);

    let sel = window.getSelection();
    if (!sel.isCollapsed && selText !== sel.toString())
        return;
    sel.empty();
    sel.addRange(range);
    selText = sel.toString();
}

function clearHighlight() {
    if (selText === null) {return;}

    let selection = window.getSelection();
    if (selection.isCollapsed || selText === selection.toString()) {
        selection.empty();
    }
    selText = null;
}

/*function isVisible() {
    let popup = document.getElementById('popup-window');
    return popup && popup.style.display !== 'none';
}*/



/**
 * Modifies selEndList so that it contains the nodes and offsets
 *  spanned by the moused over text. This is a helper for makeSearch.
 * 
 * @param {Node} startNode The text node containing the beginning of the moused over text.
 * @param {int} offset The offset of the start of the text within startNode.
 * @param {Array} selEndList The list to contain the resulting (node, offset) entries.
 * @param {int} maxLength The maximum length for the moused over text to be.
 * @return {String} The text that is being hovered over.
 */
function getText(startNode, offset, selEndList, maxLength = 7) {
    if (startNode.nodeType !== Node.TEXT_NODE) {
        return '';
    }

    let text = '';
    let endIndex = Math.min(startNode.data.length, offset + maxLength);

    text += startNode.data.substring(offset, endIndex);
    selEndList.push({
        node: startNode,
        offset: endIndex
    });

    let nextNode = startNode;
    while ((text.length < maxLength) && ((nextNode = findNextTextNode(nextNode.parentNode, nextNode)) !== null)) {
        text += getTextFromSingleNode(nextNode, selEndList, maxLength - text.length);
    }

    return text;
}


/**
 * Adds node and the offset of the last valid character to selEndList,
 *  and returns the text in node up to offset. This is a helper for getText.
 * 
 * @param {Node} node The single node to get text from.
 * @param {Array} selEndList The list to contain the (node, offset) entries.
 * @param {int} maxLength The maximum length of node text we can retrieve.
 * @returns {String} The text within the single inputted node.
 */
function getTextFromSingleNode(node, selEndList, maxLength) {
    let endIndex;

    if (node.nodeName === '#text') {
        endIndex = Math.min(maxLength, node.data.length);
        selEndList.push({
            node: node,
            offset: endIndex
        });
        return node.data.substring(0, endIndex);
    } else {
        return '';
    }
}


/**
 * Iterates through the nodes descending from root until the next text node
 * after previous is found. This is a helper method for getText.
 * 
 * @param {Node} root 
 * @param {Node} previous 
 * @returns {Node} The next text node that descends from root and is after previous.
 */
function findNextTextNode(root, previous) {
    if (root === null) {return null;}

    let nodeIterator = document.createNodeIterator(root, NodeFilter.SHOW_TEXT, null);
    let node = nodeIterator.nextNode(); // root
    while (node !== previous) {
        node = nodeIterator.nextNode();
        if (node === null) {
            return findNextTextNode(root.parentNode, previous);
        }
    }
    let result = nodeIterator.nextNode();
    if (result !== null) {
        return result;
    } else {
        return findNextTextNode(root.parentNode, previous);
    }
}


/**
 * Constructs the html for the definitions of an entry
 *  in popup. This is a helper for makeHtml.
 * 
 * @param {Array<String>} def A list of definitions in a dictionary entry.
 * @returns {String} The html for the definitions in string form.
 */
function defHtml(def) {
    if (def.length === 1) {
        return def;
    }
    else {
        let s = '';
        for (let i = 0; i < def.length; i++) {
            s += '<b>' + (i+1) + '</b> ' + def[i] + ' ';
        }
        return s.trim();
    }
}



chrome.runtime.onMessage.addListener( (request) => {
    switch (request.type) {
        case 'enable':
            enableTabs();
            break;
        case 'disable':
            disableTabs();
            break;
        case 'showPopup':
            if (window === window.top) {
                showPopup(request.text);
            }
            break;
        default:
            console.log('Content received unknown request: ', reqest)
    }
    return Promise.resolve();
});