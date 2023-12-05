// @ts-check
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  screen,
  dialog,
  globalShortcut,
  shell,
  BrowserView,
  nativeTheme,
} = require("electron");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { URL } = require("url");

app.hide();

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require("electron-squirrel-startup")) {
  app.quit();
}

if (!app.requestSingleInstanceLock()) {
  console.log("Another instance is already running");
  app.quit();
}


if (process.platform === "darwin") {
  app.dock.hide();
}

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("popcorn", process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient("popcorn");
}

app.on("open-url", (event, url) => {
  const { protocol, hostname } = new URL(url);
  if (protocol !== "popcorn:") {
    toggleView(url, null)
    return;
  }

  const popcornApp = config.apps[hostname];
  if (!popcornApp) {
    dialog.showErrorBox("Error", `App not found: ${hostname}`);
    return;
  }

  toggleView(popcornApp.url, popcornApp.name);
});

function findConfig() {
  if (process.env.POPCORN_CONFIG) {
    return process.env.POPCORN_CONFIG;
  }

  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, "popcorn", "popcorn.json");
  }

  return path.join(os.homedir(), ".config", "popcorn", "popcorn.json");
}

function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  const content = fs.readFileSync(configPath, { encoding: "utf-8" });

  return JSON.parse(content);
}

let config;
try {
  config = loadConfig(findConfig());
} catch (e) {
  dialog.showErrorBox("Error", e.message);
  app.quit();
}

function getAccelerator(shortcut) {
  if (!shortcut) {
    return null;
  }
  const parts = [];
  for (const modifier of shortcut.modifiers) {
    if (modifier == "ctrl") {
      parts.push("Control");
    }

    if (modifier == "alt") {
      parts.push("Alt");
    }

    if (modifier == "option") {
      parts.push("Alt");
    }

    if (modifier == "shift") {
      parts.push("Shift");
    }

    if (modifier == "meta") {
      parts.push("Command");
    }

    if (modifier == "super") {
      parts.push("Command");
    }

    if (modifier == "cmd") {
      parts.push("Command");
    }
  }

  parts.push(shortcut.key.charAt(0).toUpperCase() + shortcut.key.slice(1));

  return parts.join("+");
}

function getCenterOnCurrentScreen() {
  const cursor = screen.getCursorScreenPoint();
  const { width = 750, height = 440 } = config
  // Get display with cursor
  const distScreen = screen.getDisplayNearestPoint({
    x: cursor.x,
    y: cursor.y,
  });

  const { width: screenWidth, height: screenHeight } = distScreen.workAreaSize;
  const x = distScreen.workArea.x + Math.floor(screenWidth / 2 - width / 2); // * distScreen.scaleFactor
  const y = distScreen.workArea.y + Math.floor(screenHeight / 3 - height / 2);

  return {
    width,
    height,
    x,
    y,
  };
}

const createWindow = () => {
  const { x, y, width, height } = getCenterOnCurrentScreen();
  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#000" : "#fff",
    hiddenInMissionControl: true,
    frame: false,
    alwaysOnTop: true,
    type: "panel",
    skipTaskbar: true,
    movable: false,
    fullscreenable: false,
    show: false,
    minimizable: false,
    maximizable: false,
    resizable: false,
  });
  win.setWindowButtonVisibility(false);

  win.on("blur", () => {
    app.hide();
  });

  win.on("focus", () => {
    const view = win.getBrowserView();
    if (!view) {
      return;
    }

    view.webContents.focus();
  })

  return win;
};

let views = {};
function toggleView(url, name) {
  let win = BrowserWindow.getAllWindows()[0];
  if (!win) {
    win = createWindow();
  }

  const { x, y, width, height } = getCenterOnCurrentScreen();
  if (!win.isVisible()) {
    win.setBounds({ x, y, width, height });
  }

  if (views[name]) {
    const windowView = win.getBrowserView();
    if (windowView == views[name]) {
      if (win.isVisible()) {
        win.hide();
      } else {
        win.show();
      }
      return;
    }

    const view = views[name];
    view.setBounds({ x: 0, y: 0, width, height });
    win.setBrowserView(view);

    view.webContents.focus();
    win.show();
    return;
  }

  const view = new BrowserView();
  if (name) {
    views[name] = view;
  }
  view.setBounds({ x: 0, y: 0, width, height });
  view.webContents.loadURL(url).then(() => { win.show(); })
  view.webContents.on("destroyed", () => {
    delete views[name];
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      win.hide();
    }
  })


  win.setBrowserView(view);
  win.show();
  return;
}

function createTray() {
  const tray = new Tray(
    path.join(
      __dirname,
      "..",
      "assets",
      process.platform == "darwin" ? "trayiconTemplate.png" : "trayicon.png",
    ),
  );
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Apps",
      submenu: Object.entries(config.apps).map(([name, popcornApp]) => ({
        label: name,
        accelerator: getAccelerator(popcornApp.shortcut) || undefined,
        click: () => {
          toggleView(popcornApp.url, name);
        }
      })),
    },
    {
      type: "separator",
    },
    {
      label: "Edit Config",
      click: () => {
        shell.openPath(findConfig());
      }
    },
    {
      label: "Reload Config",
      click: () => {
        try {
          config = loadConfig(findConfig());
          registerShortcuts();
        } catch (e) {
          dialog.showErrorBox("Error", e.message);
        }
      }
    },
    {
      type: "separator",
    },
    {
      label: "Quit",
      accelerator: "Command+Q",
      click: () => {
        const window = BrowserWindow.getAllWindows()[0];
        window.setClosable(true);
        app.quit();
      },
    },
  ]);
  tray.setToolTip("Popcorn");
  tray.setContextMenu(contextMenu);
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  for (const [name, popcornApp] of Object.entries(config.apps)) {
    const accelerator = getAccelerator(popcornApp.shortcut);
    if (!accelerator) {
      continue;
    }
    console.debug(`Registering ${name} shortcut: ${accelerator}`);
    globalShortcut.unregister(accelerator);
    globalShortcut.register(accelerator, async () => {
      toggleView(popcornApp.url, name);
    });
  }
}

app.on("ready", () => {
  createWindow();
  createTray();
  registerShortcuts();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => { });

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
