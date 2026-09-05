package cmd

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/godbus/dbus/v5"
	"github.com/spicetify/cli/src/utils"
	"golang.org/x/net/websocket"
)

const (
	dbusMenuInterface = "com.canonical.dbusmenu"
	dbusMenuPath      = "/MenuBar"
	dbusServiceName   = "org.spicetify.GlobalMenu"
	defaultPort       = 23819
)

// DBusMenuLayout matches the DBusMenu layout signature: (ia{sv}av)
type DBusMenuLayout struct {
	ID         int32
	Properties map[string]dbus.Variant
	Children   []dbus.Variant
}

// DBusMenuGroupProps matches the DBusMenu group properties signature: (ia{sv})
type DBusMenuGroupProps struct {
	ID         int32
	Properties map[string]dbus.Variant
}

// DBusMenuEvent matches the DBusMenu event signature: (isvu)
type DBusMenuEvent struct {
	ID        int32
	EventID   string
	Data      dbus.Variant
	Timestamp uint32
}

// MenuItem represents a single menu item in the hierarchy
type MenuItem struct {
	ID          int32
	Label       string
	Shortcut    [][]string
	Icon        string
	Type        string // "standard" or "separator"
	ToggleType  string // "checkmark", "radio", or ""
	ToggleState int32  // 0 or 1
	Enabled     bool
	Visible     bool
	Action      string
	Children    []*MenuItem
}

// GlobalMenuService implements the com.canonical.dbusmenu interface
type GlobalMenuService struct {
	conn      *dbus.Conn
	mu        sync.RWMutex
	revision  uint32
	rootItem  *MenuItem
	itemsMap  map[int32]*MenuItem
	wsClients map[*websocket.Conn]bool
	wsMu      sync.Mutex
}

type stateMessage struct {
	Type     string  `json:"type"`
	IsPaused bool    `json:"isPaused"`
	Shuffle  bool    `json:"shuffle"`
	Repeat   bool    `json:"repeat"`
	Volume   float64 `json:"volume"`
	Title    string  `json:"title"`
	Artist   string  `json:"artist"`
	Album    string  `json:"album"`
	URI      string  `json:"uri"`
}

func buildDefaultMenu() (*MenuItem, map[int32]*MenuItem) {
	itemsMap := make(map[int32]*MenuItem)

	addItem := func(parent *MenuItem, item *MenuItem) *MenuItem {
		item.Enabled = true
		item.Visible = true
		itemsMap[item.ID] = item
		if parent != nil {
			parent.Children = append(parent.Children, item)
		}
		return item
	}

	root := &MenuItem{ID: 0, Enabled: true, Visible: true}
	itemsMap[0] = root

	// 1. File Menu
	fileMenu := addItem(root, &MenuItem{ID: 10, Label: "_File"})
	addItem(fileMenu, &MenuItem{ID: 11, Label: "_New Playlist", Action: "new-playlist", Shortcut: [][]string{{"Control", "n"}}, Icon: "document-new"})
	addItem(fileMenu, &MenuItem{ID: 12, Label: "_Preferences", Action: "preferences", Shortcut: [][]string{{"Control", "p"}}, Icon: "preferences-system"})
	addItem(fileMenu, &MenuItem{ID: 13, Type: "separator"})
	addItem(fileMenu, &MenuItem{ID: 14, Label: "_Close Window", Action: "close-window", Shortcut: [][]string{{"Control", "w"}}, Icon: "window-close"})
	addItem(fileMenu, &MenuItem{ID: 15, Label: "_Quit Spotify", Action: "quit", Shortcut: [][]string{{"Control", "q"}}, Icon: "application-exit"})

	// 2. Edit Menu
	editMenu := addItem(root, &MenuItem{ID: 20, Label: "_Edit"})
	addItem(editMenu, &MenuItem{ID: 21, Label: "_Undo", Action: "undo", Shortcut: [][]string{{"Control", "z"}}, Icon: "edit-undo"})
	addItem(editMenu, &MenuItem{ID: 22, Label: "_Redo", Action: "redo", Shortcut: [][]string{{"Control", "y"}}, Icon: "edit-redo"})
	addItem(editMenu, &MenuItem{ID: 23, Type: "separator"})
	addItem(editMenu, &MenuItem{ID: 24, Label: "Cu_t", Action: "cut", Shortcut: [][]string{{"Control", "x"}}, Icon: "edit-cut"})
	addItem(editMenu, &MenuItem{ID: 25, Label: "_Copy", Action: "copy", Shortcut: [][]string{{"Control", "c"}}, Icon: "edit-copy"})
	addItem(editMenu, &MenuItem{ID: 26, Label: "_Paste", Action: "paste", Shortcut: [][]string{{"Control", "v"}}, Icon: "edit-paste"})
	addItem(editMenu, &MenuItem{ID: 27, Label: "Select _All", Action: "select-all", Shortcut: [][]string{{"Control", "a"}}, Icon: "edit-select-all"})
	addItem(editMenu, &MenuItem{ID: 28, Type: "separator"})
	addItem(editMenu, &MenuItem{ID: 29, Label: "_Search", Action: "nav-search", Shortcut: [][]string{{"Control", "k"}}, Icon: "edit-find"})

	// 3. Playback Menu
	playMenu := addItem(root, &MenuItem{ID: 30, Label: "_Playback"})
	addItem(playMenu, &MenuItem{ID: 31, Label: "_Play / Pause", Action: "play-pause", Shortcut: [][]string{{"Space"}}, Icon: "media-playback-start"})
	addItem(playMenu, &MenuItem{ID: 32, Label: "_Next Track", Action: "next", Shortcut: [][]string{{"Control", "Right"}}, Icon: "media-skip-forward"})
	addItem(playMenu, &MenuItem{ID: 33, Label: "_Previous Track", Action: "prev", Shortcut: [][]string{{"Control", "Left"}}, Icon: "media-skip-backward"})
	addItem(playMenu, &MenuItem{ID: 34, Label: "Seek _Forward (10s)", Action: "seek-forward", Shortcut: [][]string{{"Shift", "Right"}}, Icon: "media-seek-forward"})
	addItem(playMenu, &MenuItem{ID: 35, Label: "Seek _Backward (10s)", Action: "seek-backward", Shortcut: [][]string{{"Shift", "Left"}}, Icon: "media-seek-backward"})
	addItem(playMenu, &MenuItem{ID: 36, Type: "separator"})
	addItem(playMenu, &MenuItem{ID: 37, Label: "_Shuffle", Action: "shuffle", ToggleType: "checkmark", ToggleState: 0, Icon: "media-playlist-shuffle"})
	addItem(playMenu, &MenuItem{ID: 38, Label: "_Repeat", Action: "repeat", ToggleType: "checkmark", ToggleState: 0, Icon: "media-playlist-repeat"})
	addItem(playMenu, &MenuItem{ID: 39, Type: "separator"})
	addItem(playMenu, &MenuItem{ID: 301, Label: "Volume _Up", Action: "volume-up", Shortcut: [][]string{{"Control", "Up"}}, Icon: "audio-volume-high"})
	addItem(playMenu, &MenuItem{ID: 302, Label: "Volume _Down", Action: "volume-down", Shortcut: [][]string{{"Control", "Down"}}, Icon: "audio-volume-low"})
	addItem(playMenu, &MenuItem{ID: 303, Label: "_Mute", Action: "volume-mute", Icon: "audio-volume-muted"})

	// 4. View Menu
	viewMenu := addItem(root, &MenuItem{ID: 40, Label: "_View"})
	addItem(viewMenu, &MenuItem{ID: 41, Label: "_Home", Action: "nav-home", Icon: "go-home"})
	addItem(viewMenu, &MenuItem{ID: 42, Label: "_Search", Action: "nav-search", Icon: "system-search"})
	addItem(viewMenu, &MenuItem{ID: 43, Label: "Your _Library", Action: "nav-library", Icon: "folder-music"})
	addItem(viewMenu, &MenuItem{ID: 44, Type: "separator"})
	addItem(viewMenu, &MenuItem{ID: 45, Label: "Toggle _Lyrics", Action: "toggle-lyrics", Icon: "format-text-bold"})
	addItem(viewMenu, &MenuItem{ID: 46, Label: "_Full Screen", Action: "full-screen", Shortcut: [][]string{{"F11"}}, Icon: "view-fullscreen"})
	addItem(viewMenu, &MenuItem{ID: 47, Type: "separator"})
	addItem(viewMenu, &MenuItem{ID: 48, Label: "Zoom _In", Action: "zoom-in", Shortcut: [][]string{{"Control", "plus"}}, Icon: "zoom-in"})
	addItem(viewMenu, &MenuItem{ID: 49, Label: "Zoom _Out", Action: "zoom-out", Shortcut: [][]string{{"Control", "minus"}}, Icon: "zoom-out"})
	addItem(viewMenu, &MenuItem{ID: 401, Label: "_Reset Zoom", Action: "zoom-reset", Shortcut: [][]string{{"Control", "0"}}, Icon: "zoom-original"})

	// 5. Help Menu
	helpMenu := addItem(root, &MenuItem{ID: 50, Label: "_Help"})
	addItem(helpMenu, &MenuItem{ID: 51, Label: "_About Spotify", Action: "about", Icon: "help-about"})
	addItem(helpMenu, &MenuItem{ID: 52, Label: "_Spicetify Documentation", Action: "spicetify-docs", Icon: "help-contents"})
	addItem(helpMenu, &MenuItem{ID: 53, Type: "separator"})
	nowPlaying := addItem(helpMenu, &MenuItem{ID: 54, Label: "Now Playing: (Stopped)", Action: "now-playing"})
	nowPlaying.Enabled = false

	return root, itemsMap
}

func (s *GlobalMenuService) itemToLayout(item *MenuItem, depth int32) DBusMenuLayout {
	props := make(map[string]dbus.Variant)

	if item.ID == 0 {
		props["children-display"] = dbus.MakeVariant("submenu")
	} else {
		if item.Type == "separator" {
			props["type"] = dbus.MakeVariant("separator")
		} else {
			props["label"] = dbus.MakeVariant(item.Label)
			props["enabled"] = dbus.MakeVariant(item.Enabled)
			if item.Icon != "" {
				props["icon-name"] = dbus.MakeVariant(item.Icon)
			}
			if len(item.Shortcut) > 0 {
				props["shortcut"] = dbus.MakeVariant(item.Shortcut)
			}
			if item.ToggleType != "" {
				props["toggle-type"] = dbus.MakeVariant(item.ToggleType)
				props["toggle-state"] = dbus.MakeVariant(item.ToggleState)
			}
			if len(item.Children) > 0 {
				props["children-display"] = dbus.MakeVariant("submenu")
			}
		}
		props["visible"] = dbus.MakeVariant(item.Visible)
	}

	childrenVariants := make([]dbus.Variant, 0, len(item.Children))
	if depth != 0 {
		nextDepth := depth
		if nextDepth > 0 {
			nextDepth--
		}
		for _, child := range item.Children {
			childLayout := s.itemToLayout(child, nextDepth)
			childrenVariants = append(childrenVariants, dbus.MakeVariant(childLayout))
		}
	}

	return DBusMenuLayout{
		ID:         item.ID,
		Properties: props,
		Children:   childrenVariants,
	}
}

// GetLayout implements com.canonical.dbusmenu.GetLayout
func (s *GlobalMenuService) GetLayout(parentId int32, recursionDepth int32, propertyNames []string) (uint32, DBusMenuLayout, *dbus.Error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	item, exists := s.itemsMap[parentId]
	if !exists {
		item = s.rootItem
	}

	layout := s.itemToLayout(item, recursionDepth)
	return s.revision, layout, nil
}

// GetGroupProperties implements com.canonical.dbusmenu.GetGroupProperties
func (s *GlobalMenuService) GetGroupProperties(ids []int32, propertyNames []string) ([]DBusMenuGroupProps, *dbus.Error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	res := make([]DBusMenuGroupProps, 0, len(ids))
	for _, id := range ids {
		item, exists := s.itemsMap[id]
		if !exists {
			continue
		}
		layout := s.itemToLayout(item, 0)
		filteredProps := make(map[string]dbus.Variant)
		if len(propertyNames) == 0 {
			filteredProps = layout.Properties
		} else {
			for _, name := range propertyNames {
				if v, ok := layout.Properties[name]; ok {
					filteredProps[name] = v
				}
			}
		}
		res = append(res, DBusMenuGroupProps{
			ID:         id,
			Properties: filteredProps,
		})
	}
	return res, nil
}

// GetProperty implements com.canonical.dbusmenu.GetProperty
func (s *GlobalMenuService) GetProperty(id int32, name string) (dbus.Variant, *dbus.Error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	item, exists := s.itemsMap[id]
	if !exists {
		return dbus.Variant{}, dbus.NewError("com.canonical.dbusmenu.UnknownItem", []any{"Item not found"})
	}

	layout := s.itemToLayout(item, 0)
	if val, ok := layout.Properties[name]; ok {
		return val, nil
	}
	return dbus.Variant{}, dbus.NewError("com.canonical.dbusmenu.UnknownProperty", []any{"Property not found"})
}

// Event implements com.canonical.dbusmenu.Event
func (s *GlobalMenuService) Event(id int32, eventID string, data dbus.Variant, timestamp uint32) *dbus.Error {
	if eventID != "clicked" {
		return nil
	}

	s.mu.RLock()
	item, ok := s.itemsMap[id]
	s.mu.RUnlock()

	if !ok || item.Action == "" {
		return nil
	}

	s.handleAction(item.Action)
	return nil
}

// EventGroup implements com.canonical.dbusmenu.EventGroup
func (s *GlobalMenuService) EventGroup(events []DBusMenuEvent) ([]int32, *dbus.Error) {
	var errors []int32
	for _, e := range events {
		if err := s.Event(e.ID, e.EventID, e.Data, e.Timestamp); err != nil {
			errors = append(errors, e.ID)
		}
	}
	return errors, nil
}

// AboutToShow implements com.canonical.dbusmenu.AboutToShow
func (s *GlobalMenuService) AboutToShow(id int32) (bool, *dbus.Error) {
	return false, nil
}

// AboutToShowGroup implements com.canonical.dbusmenu.AboutToShowGroup
func (s *GlobalMenuService) AboutToShowGroup(ids []int32) ([]int32, []int32, *dbus.Error) {
	return []int32{}, []int32{}, nil
}

// Introspect implements org.freedesktop.DBus.Introspectable.Introspect
func (s *GlobalMenuService) Introspect() (string, *dbus.Error) {
	xml := `<!DOCTYPE node PUBLIC "-//freedesktop//DTD D-BUS Object Introspection 1.0//EN"
"http://www.freedesktop.org/standards/dbus/1.0/introspect.dtd">
<node>
  <interface name="com.canonical.dbusmenu">
    <property name="Version" type="u" access="read"/>
    <property name="TextDirection" type="s" access="read"/>
    <property name="Status" type="s" access="read"/>
    <property name="IconThemePath" type="as" access="read"/>
    <method name="GetLayout">
      <arg name="parentId" type="i" direction="in"/>
      <arg name="recursionDepth" type="i" direction="in"/>
      <arg name="propertyNames" type="as" direction="in"/>
      <arg name="revision" type="u" direction="out"/>
      <arg name="layout" type="(ia{sv}av)" direction="out"/>
    </method>
    <method name="GetGroupProperties">
      <arg name="ids" type="ai" direction="in"/>
      <arg name="propertyNames" type="as" direction="in"/>
      <arg name="properties" type="a(ia{sv})" direction="out"/>
    </method>
    <method name="GetProperty">
      <arg name="id" type="i" direction="in"/>
      <arg name="name" type="s" direction="in"/>
      <arg name="value" type="v" direction="out"/>
    </method>
    <method name="Event">
      <arg name="id" type="i" direction="in"/>
      <arg name="eventId" type="s" direction="in"/>
      <arg name="data" type="v" direction="in"/>
      <arg name="timestamp" type="u" direction="in"/>
    </method>
    <method name="EventGroup">
      <arg name="events" type="a(isvu)" direction="in"/>
      <arg name="idErrors" type="ai" direction="out"/>
    </method>
    <method name="AboutToShow">
      <arg name="id" type="i" direction="in"/>
      <arg name="needUpdate" type="b" direction="out"/>
    </method>
    <method name="AboutToShowGroup">
      <arg name="ids" type="ai" direction="in"/>
      <arg name="updatesNeeded" type="ai" direction="out"/>
      <arg name="idErrors" type="ai" direction="out"/>
    </method>
    <signal name="ItemsPropertiesUpdated">
      <arg type="a(ia{sv})"/>
      <arg type="a(ias)"/>
    </signal>
    <signal name="LayoutUpdated">
      <arg type="u"/>
      <arg type="i"/>
    </signal>
    <signal name="ItemActivationRequested">
      <arg type="i"/>
      <arg type="u"/>
    </signal>
  </interface>
  <interface name="org.freedesktop.DBus.Properties">
    <method name="Get">
      <arg name="interface" type="s" direction="in"/>
      <arg name="property" type="s" direction="in"/>
      <arg name="value" type="v" direction="out"/>
    </method>
    <method name="GetAll">
      <arg name="interface" type="s" direction="in"/>
      <arg name="properties" type="a{sv}" direction="out"/>
    </method>
    <method name="Set">
      <arg name="interface" type="s" direction="in"/>
      <arg name="property" type="s" direction="in"/>
      <arg name="value" type="v" direction="in"/>
    </method>
  </interface>
  <interface name="org.freedesktop.DBus.Introspectable">
    <method name="Introspect">
      <arg name="xml" type="s" direction="out"/>
    </method>
  </interface>
</node>`
	return xml, nil
}

// Get implements org.freedesktop.DBus.Properties.Get
func (s *GlobalMenuService) Get(iface string, prop string) (dbus.Variant, *dbus.Error) {
	if iface != dbusMenuInterface {
		return dbus.Variant{}, dbus.NewError("org.freedesktop.DBus.Error.UnknownInterface", []any{"Unknown interface"})
	}
	switch prop {
	case "Version":
		return dbus.MakeVariant(uint32(3)), nil
	case "TextDirection":
		return dbus.MakeVariant("ltr"), nil
	case "Status":
		return dbus.MakeVariant("normal"), nil
	case "IconThemePath":
		return dbus.MakeVariant([]string{}), nil
	default:
		return dbus.Variant{}, dbus.NewError("org.freedesktop.DBus.Error.UnknownProperty", []any{"Unknown property"})
	}
}

// GetAll implements org.freedesktop.DBus.Properties.GetAll
func (s *GlobalMenuService) GetAll(iface string) (map[string]dbus.Variant, *dbus.Error) {
	if iface != dbusMenuInterface {
		return nil, dbus.NewError("org.freedesktop.DBus.Error.UnknownInterface", []any{"Unknown interface"})
	}
	return map[string]dbus.Variant{
		"Version":       dbus.MakeVariant(uint32(3)),
		"TextDirection": dbus.MakeVariant("ltr"),
		"Status":        dbus.MakeVariant("normal"),
		"IconThemePath": dbus.MakeVariant([]string{}),
	}, nil
}

// Set implements org.freedesktop.DBus.Properties.Set
func (s *GlobalMenuService) Set(iface string, prop string, value dbus.Variant) *dbus.Error {
	return dbus.NewError("org.freedesktop.DBus.Error.PropertyReadOnly", []any{"Property is read-only"})
}

func (s *GlobalMenuService) handleAction(action string) {
	s.wsMu.Lock()
	numClients := len(s.wsClients)
	if numClients > 0 {
		msg, _ := json.Marshal(map[string]string{"action": action})
		for ws := range s.wsClients {
			_, _ = ws.Write(msg)
		}
		s.wsMu.Unlock()
		return
	}
	s.wsMu.Unlock()

	// Fallback to MPRIS or OS
	switch action {
	case "play-pause":
		callMPRIS("PlayPause")
	case "next":
		callMPRIS("Next")
	case "prev":
		callMPRIS("Previous")
	case "quit":
		callMPRISRoot("Quit")
	case "spicetify-docs":
		_ = exec.Command("xdg-open", "https://spicetify.app").Start()
	default:
		utils.PrintWarning(fmt.Sprintf("[GlobalMenu] Extension not connected to handle: %s (MPRIS fallback unavailable)", action))
	}
}

func (s *GlobalMenuService) updateState(state stateMessage) {
	s.mu.Lock()
	s.revision++

	if playPauseItem, ok := s.itemsMap[31]; ok {
		if state.IsPaused {
			playPauseItem.Label = "_Play"
			playPauseItem.Icon = "media-playback-start"
		} else {
			playPauseItem.Label = "_Pause"
			playPauseItem.Icon = "media-playback-pause"
		}
	}
	if shuffleItem, ok := s.itemsMap[37]; ok {
		if state.Shuffle {
			shuffleItem.ToggleState = 1
		} else {
			shuffleItem.ToggleState = 0
		}
	}
	if repeatItem, ok := s.itemsMap[38]; ok {
		if state.Repeat {
			repeatItem.ToggleState = 1
		} else {
			repeatItem.ToggleState = 0
		}
	}
	if nowPlayingItem, ok := s.itemsMap[54]; ok {
		if state.Title != "" {
			nowPlayingItem.Label = fmt.Sprintf("Now Playing: %s - %s", state.Title, state.Artist)
		} else {
			nowPlayingItem.Label = "Now Playing: (Stopped)"
		}
	}
	rev := s.revision
	s.mu.Unlock()

	if s.conn != nil {
		_ = s.conn.Emit(dbusMenuPath, dbusMenuInterface+".LayoutUpdated", rev, int32(0))
	}
}

func callMPRIS(method string) {
	conn, err := dbus.ConnectSessionBus()
	if err != nil {
		return
	}
	defer conn.Close()

	obj := conn.Object("org.mpris.MediaPlayer2.spotify", "/org/mpris/MediaPlayer2")
	_ = obj.Call("org.mpris.MediaPlayer2.Player."+method, 0).Err
}

func callMPRISRoot(method string) {
	conn, err := dbus.ConnectSessionBus()
	if err != nil {
		return
	}
	defer conn.Close()

	obj := conn.Object("org.mpris.MediaPlayer2.spotify", "/org/mpris/MediaPlayer2")
	_ = obj.Call("org.mpris.MediaPlayer2."+method, 0).Err
}

func (s *GlobalMenuService) watchSpotifyWindows(stopChan <-chan struct{}) {
	ticker := time.NewTicker(1500 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-stopChan:
			s.detachAllSpotifyWindows()
			return
		case <-ticker.C:
			s.attachSpotifyWindows()
		}
	}
}

func (s *GlobalMenuService) attachSpotifyWindows() {
	winIDs := findSpotifyWindows()
	for _, id := range winIDs {
		out, err := exec.Command("xprop", "-id", id, "_KDE_NET_WM_APPMENU_SERVICE_NAME").Output()
		if err != nil || !strings.Contains(string(out), dbusServiceName) {
			_ = exec.Command("xprop", "-id", id, "-f", "_KDE_NET_WM_APPMENU_SERVICE_NAME", "8s", "-set", "_KDE_NET_WM_APPMENU_SERVICE_NAME", dbusServiceName).Run()
			_ = exec.Command("xprop", "-id", id, "-f", "_KDE_NET_WM_APPMENU_OBJECT_PATH", "8s", "-set", "_KDE_NET_WM_APPMENU_OBJECT_PATH", dbusMenuPath).Run()
			utils.PrintSuccess(fmt.Sprintf("Global Menu attached to Spotify window: %s", id))
		}
	}
}

func (s *GlobalMenuService) detachAllSpotifyWindows() {
	winIDs := findSpotifyWindows()
	for _, id := range winIDs {
		_ = exec.Command("xprop", "-id", id, "-remove", "_KDE_NET_WM_APPMENU_SERVICE_NAME").Run()
		_ = exec.Command("xprop", "-id", id, "-remove", "_KDE_NET_WM_APPMENU_OBJECT_PATH").Run()
	}
}

func findSpotifyWindows() []string {
	var result []string

	// Method 1: Try xdotool search --class spotify
	if _, err := exec.LookPath("xdotool"); err == nil {
		out, err := exec.Command("xdotool", "search", "--class", "spotify").Output()
		if err == nil {
			lines := strings.Split(strings.TrimSpace(string(out)), "\n")
			for _, line := range lines {
				line = strings.TrimSpace(line)
				if line == "" {
					continue
				}
				wmName, _ := exec.Command("xprop", "-id", line, "WM_NAME").Output()
				if strings.Contains(string(wmName), "DevTools") {
					continue
				}
				result = append(result, line)
			}
			if len(result) > 0 {
				return result
			}
		}
	}

	// Method 2: Fallback to xprop -root _NET_CLIENT_LIST
	out, err := exec.Command("xprop", "-root", "_NET_CLIENT_LIST").Output()
	if err == nil {
		str := string(out)
		idx := strings.Index(str, "#")
		if idx != -1 {
			idStrs := strings.Split(str[idx+1:], ",")
			for _, idStr := range idStrs {
				idStr = strings.TrimSpace(idStr)
				if idStr == "" {
					continue
				}
				classOut, err := exec.Command("xprop", "-id", idStr, "WM_CLASS").Output()
				if err == nil && strings.Contains(strings.ToLower(string(classOut)), "spotify") {
					wmName, _ := exec.Command("xprop", "-id", idStr, "WM_NAME").Output()
					if strings.Contains(string(wmName), "DevTools") {
						continue
					}
					result = append(result, idStr)
				}
			}
		}
	}

	return result
}

func handleAutostart(install bool) {
	home, err := os.UserHomeDir()
	if err != nil {
		utils.Fatal(err)
	}

	autostartDir := filepath.Join(home, ".config", "autostart")
	desktopFile := filepath.Join(autostartDir, "spicetify-global-menu.desktop")

	if !install {
		if err := os.Remove(desktopFile); err != nil {
			if os.IsNotExist(err) {
				utils.PrintInfo("Autostart entry not found.")
				return
			}
			utils.Fatal(err)
		}
		utils.PrintSuccess("Removed autostart entry: " + desktopFile)
		return
	}

	if err := os.MkdirAll(autostartDir, 0755); err != nil {
		utils.Fatal(err)
	}

	exPath, err := os.Executable()
	if err != nil {
		exPath = "spicetify"
	}

	content := fmt.Sprintf(`[Desktop Entry]
Type=Application
Name=Spicetify Global Menu
Comment=KDE Global Menu Bridge for Spotify
Exec=%s global-menu
Terminal=false
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
`, exPath)

	if err := os.WriteFile(desktopFile, []byte(content), 0644); err != nil {
		utils.Fatal(err)
	}

	utils.PrintSuccess("Created autostart entry: " + desktopFile)
	utils.PrintInfo("Spicetify Global Menu will now automatically start on login.")
}

// GlobalMenu starts the global menu daemon
func GlobalMenu(args []string) {
	port := defaultPort

	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--install-autostart":
			handleAutostart(true)
			return
		case "--uninstall-autostart":
			handleAutostart(false)
			return
		case "--port":
			if i+1 < len(args) {
				p, err := strconv.Atoi(args[i+1])
				if err == nil && p > 0 {
					port = p
					i++
				}
			}
		case "-h", "--help":
			utils.PrintBold("spicetify global-menu")
			fmt.Println(`
USAGE
    spicetify global-menu [flags]

FLAGS
    --port <number>            Port for WebSocket connection (default: 23819)
    --install-autostart        Create desktop autostart entry (~/.config/autostart/)
    --uninstall-autostart      Remove desktop autostart entry
    -h, --help                 Display this help message`)
			return
		}
	}

	utils.PrintBold("Spicetify Global Menu Daemon")
	utils.PrintInfo(fmt.Sprintf("Connecting to D-Bus Session Bus (%s)...", dbusServiceName))

	conn, err := dbus.ConnectSessionBus()
	if err != nil {
		utils.Fatal(fmt.Errorf("failed to connect to session bus: %w", err))
	}
	defer conn.Close()

	reply, err := conn.RequestName(dbusServiceName, dbus.NameFlagDoNotQueue|dbus.NameFlagReplaceExisting)
	if err != nil {
		utils.Fatal(fmt.Errorf("failed to request bus name: %w", err))
	}
	if reply != dbus.RequestNameReplyPrimaryOwner {
		utils.Fatal(fmt.Errorf("bus name %s is already taken by another process", dbusServiceName))
	}

	root, itemsMap := buildDefaultMenu()
	service := &GlobalMenuService{
		conn:      conn,
		revision:  1,
		rootItem:  root,
		itemsMap:  itemsMap,
		wsClients: make(map[*websocket.Conn]bool),
	}

	_ = conn.Export(service, dbusMenuPath, dbusMenuInterface)
	_ = conn.Export(service, dbusMenuPath, "org.freedesktop.DBus.Properties")
	_ = conn.Export(service, dbusMenuPath, "org.freedesktop.DBus.Introspectable")

	utils.PrintSuccess(fmt.Sprintf("D-Bus service registered on %s %s", dbusServiceName, dbusMenuPath))

	// Start WebSocket Server
	mux := http.NewServeMux()
	mux.Handle("/ws", websocket.Handler(func(ws *websocket.Conn) {
		service.wsMu.Lock()
		service.wsClients[ws] = true
		service.wsMu.Unlock()

		utils.PrintSuccess("Spotify client connected via WebSocket!")

		defer func() {
			service.wsMu.Lock()
			delete(service.wsClients, ws)
			service.wsMu.Unlock()
			utils.PrintInfo("Spotify client disconnected from WebSocket")
		}()

		buf := make([]byte, 4096)
		for {
			n, err := ws.Read(buf)
			if err != nil {
				if err != io.EOF {
					utils.PrintWarning(fmt.Sprintf("WebSocket read error: %v", err))
				}
				break
			}
			var state stateMessage
			if err := json.Unmarshal(buf[:n], &state); err == nil && state.Type == "state" {
				service.updateState(state)
			}
		}
	}))

	server := &http.Server{
		Addr:    fmt.Sprintf("127.0.0.1:%d", port),
		Handler: mux,
	}

	go func() {
		utils.PrintInfo(fmt.Sprintf("Starting local WebSocket server on ws://127.0.0.1:%d/ws...", port))
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			utils.Fatal(fmt.Errorf("WebSocket server failed: %w", err))
		}
	}()

	stopChan := make(chan struct{})
	go service.watchSpotifyWindows(stopChan)

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	utils.PrintSuccess("Global Menu daemon is active and monitoring Spotify windows.")
	utils.PrintInfo("Press Ctrl+C to stop.")

	<-sigChan
	utils.PrintInfo("\nShutting down Global Menu daemon...")
	close(stopChan)
	_ = server.Close()
	service.detachAllSpotifyWindows()
	utils.PrintSuccess("Global Menu daemon stopped cleanly.")
}

