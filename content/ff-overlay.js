/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

(function() {
  let DEBUG = 1;
  if (DEBUG) debug = function(s) {
    dump("-*- ADBService FF Overlay: " + s + "\n");
    this.console = Components.classes["@mozilla.org/consoleservice;1"].getService(Components.interfaces.nsIConsoleService);
    this.console.logStringMessage("-*- ADBService FF Overlay: " + s + "\n");
  };
  else
  debug = function(s) {};
  var isDisabled = false;
  var modules = {};
  XPCOMUtils.defineLazyServiceGetter(modules, "cpmm", "@mozilla.org/childprocessmessagemanager;1", "nsISyncMessageSender");

  function init() {
    // Import ADB Service module
    debug('Import adbService module');

    Components.utils.import('resource://ffosassistant/ADBService.jsm');
    Components.utils.import('resource://ffosassistant/driverDownloader.jsm');
    Components.utils.import('resource://ffosassistant/driverManager.jsm');
    Components.utils.import("resource://gre/modules/AddonManager.jsm");


    // Register messages
    const messages = ['ADBService:statechange'];
    messages.forEach(function(msgName) {
      modules.cpmm.addMessageListener(msgName, messageHandler)
    });

    //var osString = Components.classes["@mozilla.org/xre/app-info;1"]
    //  .getService(Components.interfaces.nsIXULRuntime).OS;
    var os = (function() {
      var oscpu = navigator.oscpu.toLowerCase();
      return {
        isWindows: /windows/.test(oscpu),
        isLinux: /linux/.test(oscpu),
        isMac: /mac/.test(oscpu)
      };
    })();
    debug('os.isWindows =' + os.isWindows);
    if (os.isWindows) {
      this._addonListener = {
        onUninstalled: function(addon) {
          if (addon.id == "ffosassistant@mozillaonline.com") {
            isDisabled = true;
            if (client != null && client.isConnected()) client.sendCommand('shutdown', function() {});
            ADBService.startDeviceDetecting(false);
            ADBService.killAdbServer();
          }
        },
        onDisabling: function(addon, needsRestart) {
          debug('onDisabled ' + addon.id);
          if (addon.id == "ffosassistant@mozillaonline.com") {
            isDisabled = true;
            debug('onDisabled ' + client.isConnected());
            if (client != null && client.isConnected()) client.sendCommand('shutdown', function() {});
            ADBService.startDeviceDetecting(false);
            ADBService.killAdbServer();
          }
        },
        onOperationCancelled: function(addon, needsRestart) {
          if (addon.id == "ffosassistant@mozillaonline.com") {
            if (isDisabled == false) {
              isDisabled = true;
              ADBService.startAdbServer();
              ADBService.startDeviceDetecting(true);
              if (!navigator.mozFFOSAssistant.isDriverManagerRunning) {
                navigator.mozFFOSAssistant.startDriverManager();
              }
              window.setTimeout(connectToDriverManager, 1000);
            }
          }
        }
      };
      AddonManager.addAddonListener(this._addonListener);
      if (!navigator.mozFFOSAssistant.isDriverManagerRunning) {
        navigator.mozFFOSAssistant.startDriverManager();
      }
      window.setTimeout(connectToDriverManager, 2000);
    }
    checkFirstRun();
    if (isDisabled == false) ADBService.startDeviceDetecting(true);
  }

  function checkFirstRun() {
    var firstRunPref = 'extensions.ffosassistant@mozillaonline.com.firstrun';
    if (Services.prefs.getBoolPref(firstRunPref, true)) {
      Services.prefs.setBoolPref(firstRunPref, false);
      openFFOSInAPinnedTab();
      addToolbarButton();
    }
  }

  function addToolbarButton() {
    var navBar = document.getElementById('nav-bar');
    var currentSet = navBar.currentSet;

    var buttonId = 'ffosassistant-button';
    if (currentSet.indexOf(buttonId) == -1) {
      var set = navBar.currentSet + '';
      var MANULLAY_REMOVE_PREF = 'extensions.ffosassistant@mozillaonline.com.manuallyRemovedButton';
      var manuallyRemovedButton = Services.prefs.getBoolPref(MANULLAY_REMOVE_PREF, false);

      if (manuallyRemovedButton) {
        return;
      }

      set = set + ',' + buttonId;

      navBar.setAttribute('currentset', set);
      navBar.currentSet = set;
      document.persist('nav-bar', 'currentset');

      BrowserToolboxCustomizeDone(true);
    }

    // Check whether user has manually removed the toolbar button
    navBar.addEventListener('DOMAttrModified', function(event) {
      if (event.type == 'DOMAttrModified' && event.attrName == 'currentset') {
        if (event.newValue.indexOf('ffosassistant-button') == -1) {
          Services.prefs.setBoolPref(MANULLAY_REMOVE_PREF, true);
        }
      }
    });
  }

  function openFFOSInAPinnedTab() {
    var tab = null;
    if (isTabEmpty(gBrowser.selectedTab)) {
      tab = gBrowser.selectedTab;
      gBrowser.selectedBrowser.loadURI('about:ffos');
    } else {
      tab = gBrowser.loadOneTab('about:ffos', {
        inBackground: false
      });
    }

    var pinPref = 'extensions.ffosassistant@mozillaonline.com.pinnedOnOpen';
    if (Services.prefs.getBoolPref(pinPref, true)) {
      gBrowser.pinTab(tab);
    }
  }

  // Copy from Firefox4
  if (!window["switchToTabHavingURI"]) {
    window["isTabEmpty"] = function(aTab) {
      var browser = aTab.linkedBrowser;
      return browser.sessionHistory.count < 2 && browser.currentURI.spec == "about:blank" && !browser.contentDocument.body.hasChildNodes() && !aTab.hasAttribute("busy");
    }

    window["switchToTabHavingURI"] = function(aURI, aOpenNew) {
      function switchIfURIInWindow(aWindow) {
        var browsers = aWindow.gBrowser.browsers;
        for (var i = 0; i < browsers.length; i++) {
          var browser = browsers[i];
          if (browser.currentURI.equals(aURI)) {
            aWindow.focus();
            aWindow.gBrowser.tabContainer.selectedIndex = i;
            return true;
          }
        }
        return false;
      }

      if (!(aURI instanceof Ci.nsIURI)) {
        var ioServices = Components.classes['@mozilla.org/network/io-service;1'].getService(Components.interfaces.nsIIOService);
        aURI = ioServices.newURI(aURI, null, null);
      }

      var isBrowserWindow = !! window.gBrowser;
      if (isBrowserWindow && switchIfURIInWindow(window)) {
        return true;
      }

      var winEnum = jsm.windowMediator.getEnumerator("navigator:browser");
      while (winEnum.hasMoreElements()) {
        var browserWin = winEnum.getNext();
        if (browserWin.closed || browserWin == window) {
          continue;
        }
        if (switchIfURIInWindow(browserWin)) {
          return true;
        }
      }

      if (aOpenNew) {
        if (isBrowserWindow && isTabEmpty(gBrowser.selectedTab)) {
          gBrowser.selectedBrowser.loadURI(aURI.spec);
        } else {
          openUILinkIn(aURI.spec, "tab");
        }
      }

      return false;
    }
  }

  let heartBeatSocket = null;
  let messageHandler = {
    receiveMessage: function(aMessage) {
      var connected = aMessage.json.connected;
      debug('Receive message: ' + connected);
      if (connected) {
        // Establish a heart-beat socket, and stop usb querying interval
        heartBeatSocket = navigator.mozTCPSocket.open('localhost', 10010);
        heartBeatSocket.onclose = function onclose_socket() {
          // Restart usb querying interval
          if (isDisabled == false) ADBService.startDeviceDetecting(true);
        };
        ADBService.startDeviceDetecting(false);
      }
    }
  };

  // Add tcp socket permissions for debugging
  if (Services.prefs.getBoolPref('extensions.ffosassistant@mozillaonline.com.debug')) {
    let domain = Services.prefs.getCharPref('extensions.ffosassistant@mozillaonline.com.tcp_socket_allow_domain');
    var ios = Components.classes['@mozilla.org/network/io-service;1'].getService(Components.interfaces.nsIIOService);
    uri = ios.newURI(domain, null, null);

    Services.perms.add(uri, 'tcp-socket', Components.interfaces.nsIPermissionManager.ALLOW_ACTION);
  }

  var client = null;

  function connectToDriverManager() {
    if (navigator.mozFFOSAssistant.driverManagerPort) {
      client = new TelnetClient({
        // host: '10.241.5.197',
        host: '127.0.0.1',
        port: navigator.mozFFOSAssistant.driverManagerPort,
        onmessage: handleMessage,
        onopen: onopen,
        onclose: onclose
      }).connect();
    } else {
      window.setTimeout(connectToDriverManager, 1000);
      debug("DriverManager process is not running, try to connect it again!");
    }
  }

  function handleMessage(msg) {
    if (!msg) {
      return;
    }
    switch (msg.type) {
    case 'notification':
      debug('Got an notification');
      checkNotification();
      break;
    case 'deviceChanged':
      onDeviceChanged(msg);
      break;
    case 'driverInstalled':
      onDriverInstalled(msg);
      break;
    }
  }

  function onDeviceChanged(msg) {
    window.clearTimout(failToInstallTimeout);
/*new ModalDialog({
        title: 'Device Changed',
        titleL10n: 'device-changed-title',
        bodyText: 'We detected that device is changed.',
        bodyTextL10n: 'device-changed-body'
      });*/
    checkDriverStatus();
  }

  var failToInstallTimeout = null;

  function onDriverInstalled(msg) {
    // `driverInstalled` means the driver installer running completes, however it
    // does not mean the driver for the plugged device is installed, so it's not
    // a reliable event for ensuring driver-failed-to-be-installed, we need to try
    // to connect to the device and double check `adbConnected`.
    //
    // We don't need to fire device-ready-event here, we will might receive a
    // device-change event if driver is installed successfully.
    if (msg.data.errorName && !navigator.mozFFOSAssistant.adbConnected) {
/*new ModalDialog({
        title: 'Failed To Install Driver',
        titleL10n: 'failed-install-driver-title',
        bodyText: 'We encountered an error when installing driver: ' + msg.data.errorMessage,
        bodyTextL10n: 'failed-install-driver-body'
      });*/
    } else {
      // Sometimes we can't receive a device-change event, we need to set a timeout
      // to fire fail-to-install event
      failToInstallTimeout = window.setTimeout(function() {
/*new ModalDialog({
          title: 'Failed To Install Driver',
          titleL10n: 'failed-install-driver-title',
          bodyText: 'We encountered an error when installing driver: ' + 'no device-storage changed event is received.',
          bodyTextL10n: 'failed-install-driver-body'
        });*/
      }, 5000);
    }
  }
  var _doubleCheckTimeout = null;

  function checkDriverStatus() {
    client.sendCommand('list', function(message) {
      if (message.data.length == 0) {
        //ModalDialog.closeAll();
        return;
      } else {
/*new ModalDialog({
          title: 'Device Found',
          titleL10n: 'device-found-title',
          bodyText: 'We detected a FFOS device',
          bodyTextL10n: 'device-found-body'
        });*/
      }
      // TODO handle all devices
      if (message.data[0].state == 'installed') {
        //ModalDialog.closeAll();
        return;
      }

      // Windows need to load the driver when USB connected, so sometimes
      // the message told us it's not installed, we need wait for seconds
      // and query again to double check the status.
      window.clearTimeout(_doubleCheckTimeout);
      _doubleCheckTimeout = window.setTimeout(doCheckAndInstallDrivers, 5000);
    });
  }

  function doCheckAndInstallDrivers() {
    debug('Double check the driver installation state.');
    client.sendCommand('list', function(message) {
      if (message.data.length == 0) {
        //ModalDialog.closeAll();
        return;
      }
      // TODO handle all devices
      if (message.data[0].state == 'installed') {
        //ModalDialog.closeAll();
        return;
      }
      var instanceId = message.data[0].deviceInstanceId;
      var driverPath = navigator.mozFFOSAssistant.sendCmdToDriverDownloader({
        command: 'getInstallerPath',
        deviceInstanceId: instanceId
      });
/*new ModalDialog({
        title: 'Installing driver',
        titleL10n: 'installing-driver-title',
        bodyText: 'We are installing driver for you.',
        bodyTextL10n: 'installing-driver-body',
        cancelable: false
      });*/
      client.sendCommand('install', instanceId, driverPath, function(message) {
        debug('Receive install message: ' + JSON.stringify(message));
      });
    });
  }

  function onopen() {
    debug('Telnet client is opened.');
    client.sendCommand("info", function(message) {
      debug("info: " + message);
    });
    checkDriverStatus();
  }

  function onclose() {
    debug('telnet client is closed.');
  }

  function checkNotification() {
    // Check the message, and decide what to do next.
    client.sendCommand('message', handleMessage);
  }

  window.addEventListener('load', function wnd_onload(e) {
    window.removeEventListener('load', wnd_onload);
    window.setTimeout(init, 1000);
  });
})();

function TelnetClient(options) {
  this.initialize(options);
}
TelnetClient.prototype = {
  initialize: function tc_init(options) {
    this.options = utils.extend({
      host: 'localhost',
      port: 0,
      onmessage: utils.emptyFunction,
      onopen: utils.emptyFunction,
      onclose: utils.emptyFunction
    }, options);

    if (!this.options.port) {
      throw Error('No port is specified.');
    }

    this._callback = null;
    this._queue = [];
    this._connected = false;
    this._socket = null;

/*var self = this;
    window.addEventListener("unload", function(event) {
      debug('unload window');
      self.disconnect();
    }, true);*/
  },

  _onopen: function onopen(event) {
    debug('Connection is opened.');
    this._connected = true;
    this._socket.onclose = this._onclose.bind(this);
    this._socket.ondata = this._ondata.bind(this);
    this.options.onopen(event);
  },

  _onclose: function onclose(event) {
    debug('Connection is closed.');
    this._connected = false;
    this._socket = null;
    this._callback = null;
    this._queue = [];
    this.options.onclose(event);
  },

  _ondata: function ondata(event) {
    debug('Received data: ' + event.data);
    var recvData = this._filterNotification(event.data);

    var data = null;

    try {
      data = JSON.parse(recvData);
    } catch (e) {
      debug('Not a valid JSON string.');
      return;
    }

    // Check if the _callback is null, if yes, it means the message
    // is the echo for last command.
    try {
      if (this._callback) {
        this._callback(data);
      } else {
        this.options.onmessage(data);
      }
    } catch (e) {
      debug('Error occurs when invoking callback: ' + e);
    } finally {
      this._callback = null;
      this._sendQueuedCommand();
    }
  },

  _filterNotification: function(str) {
    // Tranverse the event.data, if we received '\b' (charcode: 7), it
    // means we received a notification.
    var filteredStr = '';

    for (var i = 0; i < str.length; i++) {
      var charCode = str.charCodeAt(i);
      if (charCode == 7) {
        // We got a notification.
        this.options.onmessage({
          type: 'notification'
        });
      } else {
        filteredStr += str.charAt(i);
      }
    }

    return filteredStr;
  },

  _sendQueuedCommand: function() {
    if (this._queue.length > 0) {
      this.sendCommand.apply(this, this._queue.shift());
    }
  },

  /* Interfaces */
  isConnected: function() {
    return !!this._connected;
  },

  connect: function() {
    if (this._socket) {
      return this;
    }

    this._socket = navigator.mozTCPSocket.open(this.options.host, this.options.port, {
      binaryType: 'string'
    });

    this._socket.onopen = this._onopen.bind(this);
    this._socket.onerror = function(event) {
      alert("telnet error: " + event.data);
    };

    return this;
  },

  disconnect: function() {
    debug("disconnect socket: " + this._connected);
    if (this._connected) {
      this._socket.close();
    }
  },

  /**
   * arguments:
   *   command, arg1, arg2 ... argn, callback
   *
   * The last argument should be the callback function to receive
   * the echo message.
   */
  sendCommand: function tc_sendCommand() {
    if (!this.isConnected()) {
      throw Error('Server is disconnected.');
    }

    // One command at a time.
    if (this._callback) {
      this._queue.push(arguments);
      return;
    }

    // There will be an echo sent back whenever we send a command,
    // so we need cache the callback here.
    var args = [];
    for (var i = 0; i < arguments.length; i++) {
      if (typeof arguments[i] == 'function') {
        this._callback = arguments[i];
        break;
      }
      args.push(arguments[i]);
    }

    // Check if the callback is null, if yes, set it with emptyFunction
    // which means the next message is an echo for this command, not an
    // initiative message from the server.
    this._callback = this._callback || emptyFunction;

    var command = args.join("\t") + "\n";
    this._socket.send(command);
    debug('xds2');
  }
};