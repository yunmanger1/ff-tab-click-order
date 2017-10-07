/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/** Global state, stores tab access history using two stacks
  */
let stackMap = new Map();
let isRolling = false;
const debugging = false;
const ROLLING_TIMEOUT = 2000;
const MAX_STACK_LENGTH = 20;

function debug_log(...rest) {
  if (debugging)
    console.log.apply(console, rest);
}

const getStacks = (windowId) => (stackMap.get(windowId) || [[], []]);
const saveStacks = (windowId, leftStack, rightStack) => {
  leftStack.splice(0, Math.max(0, leftStack.length - MAX_STACK_LENGTH));
  rightStack.splice(0, Math.max(0, leftStack.length - MAX_STACK_LENGTH));
  stackMap.set(windowId, [leftStack, rightStack]);
};

const pushBack = (windowId, tabId) => {
  debug_log(`pushBack(${tabId}) begin`);
  let [leftStack, rightStack] = getStacks(windowId);
  debug_log(leftStack, rightStack);
  leftStack.push(tabId);
  saveStacks(windowId, leftStack, []);
  return leftStack.length ? leftStack[leftStack.length - 1] : null;
  debug_log(`pushBack() end`);
};

const rollLeft = (windowId) => {
  let [leftStack, rightStack] = getStacks(windowId);
  debug_log(leftStack, rightStack);
  if (leftStack.length > 1) {
    rightStack.push(leftStack.pop());
  }
  saveStacks(windowId, leftStack, rightStack);
  return leftStack.length ? leftStack[leftStack.length - 1] : null;
};

const rollRight = (windowId) => {
  let [leftStack, rightStack] = getStacks(windowId);
  debug_log(leftStack, rightStack);
  if (rightStack.length > 0) {
    leftStack.push(rightStack.pop());
  }
  saveStacks(windowId, leftStack, rightStack);
  return leftStack.length ? leftStack[leftStack.length - 1] : null;
};

const cleanUp = (windowId, aliveTabIds) => {
  let [leftStack, rightStack] = getStacks(windowId);
  debug_log(leftStack, rightStack);
  leftStack = leftStack.filter(t => aliveTabIds.indexOf(t) != -1);
  rightStack = rightStack.filter(t => aliveTabIds.indexOf(t) != -1);
  saveStacks(windowId, leftStack, rightStack);
  return leftStack.length ? leftStack[leftStack.length - 1] : null;
};
const scheduleUnroll = () => setTimeout(() => {
  isRolling = false;
}, ROLLING_TIMEOUT);

const silentlyUpdateTab = (tabId) => {
  debug_log(`silentlyUpdateTab(${tabId}) begin`);
  if (tabId === null) return;
  isRolling = true;
  browser.tabs.update(tabId, {active: true}).then(scheduleUnroll, scheduleUnroll);
  debug_log("silentlyUpdateTab() end");
};

// callback for "go to last tab" shortcut
function cursorLeft() {
  debug_log("cursorLeft() begin");

  // load the current window
  browser.windows.getCurrent({populate: true}).then((windowInfo) => {
    if (windowInfo.type != "normal") {
      debug_log (`Current window is of type '${windowInfo.type}', ignoring`);
      return;
    }

    if (!stackMap.has(windowInfo.id)) {
      debug_log (`Nothing known about ${windowInfo.id}`);
      return; //no info on this window to use
    }

    silentlyUpdateTab(rollLeft(windowInfo.id));

  }, onError);

  debug_log("cursorLeft() end");
}

// callback for "go to last tab" shortcut
function cursorRight() {
  debug_log("cursorRight() begin");

  // load the current window
  browser.windows.getCurrent({populate: true}).then((windowInfo) => {
    if (windowInfo.type != "normal") {
      debug_log (`Current window is of type '${windowInfo.type}', ignoring`);
      return;
    }

    if (!stackMap.has(windowInfo.id)) {
      debug_log (`Nothing known about ${windowInfo.id}`);
      return; //no info on this window to use
    }

    silentlyUpdateTab(rollRight(windowInfo.id));

  }, onError);

  debug_log("cursorRight() end");
}

// callback when a tab is activated
function tabActivated({windowId, tabId}) {
  debug_log("tabActivated(newTabInfo) begin");

  if (isRolling) return;

  pushBack(windowId, tabId);

  debug_log("tabActivated(newTabInfo) end");
}

// callback when a window is removed
function windowRemoved(windowId) {
  // the window has been destroyed, so we can stop tracking tabs for it
  debug_log(`Window ${windowId} deleted, removing key.`);
  stackMap.delete(windowId);
}


// General error handler, logs the error for debugging.
function onError(error) {
  debug_log(`Error: ${error}`);
}

// Hook the keyboard shortcut
browser.commands.onCommand.addListener((command) => {
  switch(command) {
    case "roll-left":
      cursorLeft();
      break;
    case "roll-right":
      cursorRight();
      break;
    case "clear-stacks":
      stackMap.clear();
      initWindows();
      break;
    default:
      debug_log ("onCommand event received unknown message: ", command);
	};
});

// hook tab change to track history
browser.tabs.onActivated.addListener(tabActivated);

// on window destroy, remove it from stackMap
browser.windows.onRemoved.addListener(windowRemoved);

// hook the toolbar icon
browser.browserAction.onClicked.addListener(cursorLeft);

// initialize the state with the current tab for each window
function initAWindow(windowInfoArray) {
  for (let windowInfo of windowInfoArray) {
    let windowId = windowInfo.id;
    let activeTab = windowInfo.tabs.filter((e) => e.active == true);
    if (activeTab.length != 1) {
      debug_log (`Error, no active tab for window ${windowId}`);
      continue;
    }
    let tabId = activeTab[0].id;
    debug_log (`Window ${windowId} has active tab ${tabId}`);

    pushBack(windowId, tabId);
  }
}

const cleanUpWindows = (windowInfoArray) => {
 for (let windowInfo of windowInfoArray) {
    let windowId = windowInfo.id;
    let aliveTabIds = windowInfo.tabs.map((e) => e.id);
    cleanUp(windowId, aliveTabIds);
  }
};

function initWindows() {
  var getting = browser.windows.getAll({
    populate: true,
    windowTypes: ["normal"]
  });
  getting.then(initAWindow, onError);
}

initWindows();
setInterval(() => browser.windows.getAll({
                    populate: true,
                    windowTypes: ["normal"]
                  }).then(cleanUpWindows, onError),
            1000);
