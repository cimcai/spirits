#!/usr/bin/env python3
"""
Ultimarc USBButton LED Controller for CIMC Spirits

Polls the /api/led-status endpoint and controls Ultimarc USBButton LEDs
based on philosopher confidence levels.

Each USBButton is a separate USB device with a built-in RGB LED.
This script finds all connected USBButtons and maps them to philosopher
indices (1, 2, 3) in the order they are discovered.

SETUP:
  1. pip install hidapi requests
  2. Configure APP_URL below to point to your running app
  3. Plug in your USBButton devices (up to 3)
  4. Run: python ultimarc-led-controller.py [optional-app-url]

REPROGRAMMING BUTTON ACTIONS:
  By default, USBButtons open usbbutton.com when pressed.
  Use Ultimarc's U-Config tool to reprogram them to send keyboard
  keys 1, 2, 3 instead:
    https://www.ultimarc.com/control-interfaces/u-hid-en/u-config/

LINUX UDEV RULE (for non-root access):
  echo 'SUBSYSTEM=="usb", ATTRS{idVendor}=="d209", MODE:="0666"' | \
    sudo tee /etc/udev/rules.d/99-ultimarc.rules
  sudo udevadm control --reload-rules && sudo udevadm trigger
"""

import sys
import time
import math
import json
import os

IS_WINDOWS = os.name == "nt"

if IS_WINDOWS:
    import msvcrt
else:
    import select
    import tty
    import termios

try:
    import hid
except ImportError:
    print("ERROR: hidapi not installed. Run: pip install hidapi")
    sys.exit(1)

try:
    import requests
except ImportError:
    print("ERROR: requests not installed. Run: pip install requests")
    sys.exit(1)

# ---------------------------------------------------------------------------
# CONFIGURATION
# ---------------------------------------------------------------------------

APP_URL = "https://cimc.io"

POLL_INTERVAL = 0.1

ULTIMARC_VENDOR_ID = 0xD209
USBBUTTON_PRODUCT_ID = 0x1200

PULSE_SPEED = 2.0
MIN_PULSE_BRIGHTNESS = 0.2
CONFIDENCE_THRESHOLD = 50
BUTTON_DEBOUNCE = 1.0  # seconds between accepting repeated button presses

# Set this to a method number (0-10) after running --diagnose to only use
# the method that actually works. None = try all methods.
WORKING_METHOD = 7

# Which HID interface indices (0-based) control the LEDs for each button.
# From bruteforce test: interfaces 1, 5, 9 lit up (i.e. indices 0, 4, 8).
# Map: Button 1 (philosopher 1) = interface 0, Button 2 = interface 4, Button 3 = interface 8
# Change these if your buttons respond on different interfaces.
BUTTON_INTERFACES = [0, 4, 8]

# ---------------------------------------------------------------------------
# Color utilities
# ---------------------------------------------------------------------------

def hex_to_rgb(hex_color):
    hex_color = hex_color.lstrip("#")
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))


def scale_rgb(rgb, factor, quantize=4):
    """Scale RGB by factor. Quantize to reduce redundant LED writes during pulsing.
    quantize=4 means 64 brightness levels (still visually smooth)."""
    def q(v):
        v = max(0, min(255, int(v * factor)))
        return (v // quantize) * quantize
    return (q(rgb[0]), q(rgb[1]), q(rgb[2]))

# ---------------------------------------------------------------------------
# USBButton device - each button is a separate HID device with RGB LED
# ---------------------------------------------------------------------------

class USBButtonDevice:
    def __init__(self, path, index):
        self.path = path
        self.index = index
        self.device = None

    def connect(self):
        try:
            self.device = hid.device()
            self.device.open_path(self.path)
            self.device.set_nonblocking(1)
            name = self.device.get_product_string() or "USBButton"
            print("  Button %d: Connected (%s)" % (self.index, name))
            return True
        except Exception as e:
            print("  Button %d: Failed to connect - %s" % (self.index, e))
            self.device = None
            return False

    def set_color(self, r, g, b, verbose=False):
        """Set LED color. Uses the configured WORKING_METHOD if set,
        otherwise tries all methods."""
        if not self.device:
            return False
        r = max(0, min(255, int(r)))
        g = max(0, min(255, int(g)))
        b = max(0, min(255, int(b)))

        all_methods = self._get_methods(r, g, b)

        if WORKING_METHOD is not None and WORKING_METHOD < len(all_methods):
            name, fn = all_methods[WORKING_METHOD]
            try:
                fn()
                return True
            except Exception:
                return False

        any_ok = False
        for name, fn in all_methods:
            try:
                fn()
                any_ok = True
            except Exception:
                pass
        return any_ok

    def set_color_bruteforce(self, r, g, b):
        """Try ALL write methods on this device with verbose output."""
        if not self.device:
            return
        r = max(0, min(255, int(r)))
        g = max(0, min(255, int(g)))
        b = max(0, min(255, int(b)))

        for name, fn in self._get_methods(r, g, b):
            try:
                fn()
                print("    [%d] %s -> OK" % (self.index, name))
            except Exception as e:
                print("    [%d] %s -> FAIL: %s" % (self.index, name, e))

    def _get_methods(self, r, g, b):
        return [
            ("0: feature[0,R,G,B,0]",     lambda: self.device.send_feature_report([0x00, r, g, b, 0x00])),
            ("1: feature[0,0,R,G,B]",     lambda: self.device.send_feature_report([0x00, 0x00, r, g, b])),
            ("2: feature[0,1,R,G,B]",     lambda: self.device.send_feature_report([0x00, 0x01, r, g, b])),
            ("3: write[0,R,G,B]",         lambda: self.device.write([0x00, r, g, b])),
            ("4: write[0,0,R,G,B]",       lambda: self.device.write([0x00, 0x00, r, g, b])),
            ("5: write[R,G,B]",           lambda: self.device.write([r, g, b])),
            ("6: feature[0,R,G,B]",       lambda: self.device.send_feature_report([0x00, r, g, b])),
            ("7: write[0,1,R,G,B]",       lambda: self.device.write([0x00, 0x01, r, g, b])),
            ("8: feature[1,R,G,B,0]",     lambda: self.device.send_feature_report([0x01, r, g, b, 0x00])),
            ("9: write[0,0,0,R,G,B]",     lambda: self.device.write([0x00, 0x00, 0x00, r, g, b])),
            ("10: feature[0,0,0,R,G,B]",  lambda: self.device.send_feature_report([0x00, 0x00, 0x00, r, g, b])),
        ]

    def read_input(self):
        """Non-blocking read. Returns data bytes if a button press was detected, else None."""
        if not self.device:
            return None
        try:
            data = self.device.read(64)
            if data:
                return data
        except Exception:
            pass
        return None

    def close(self):
        if self.device:
            try:
                self.device.close()
            except Exception:
                pass
            self.device = None


def enumerate_usb_buttons():
    """Enumerate all USBButton HID interfaces and return unique list."""
    devices = hid.enumerate(ULTIMARC_VENDOR_ID, USBBUTTON_PRODUCT_ID)
    seen_paths = set()
    unique_devices = []
    for dev in devices:
        path = dev.get("path", b"")
        if path not in seen_paths:
            seen_paths.add(path)
            unique_devices.append(dev)
    return unique_devices


def find_usb_buttons(led_indices=None, bruteforce=False):
    """Find USBButton devices. If led_indices is provided, only open those
    specific interface indices (0-based). Otherwise open all."""
    unique_devices = enumerate_usb_buttons()

    print("Found %d USBButton HID interface(s)" % len(unique_devices))
    for i, dev in enumerate(unique_devices):
        iface = dev.get("interface_number", "?")
        usage = dev.get("usage", "?")
        usage_page = dev.get("usage_page", "?")
        marker = " <-- LED" if (led_indices and i in led_indices) else ""
        print("  [%d] interface=%s usage_page=0x%s usage=0x%s%s" % (
            i, iface,
            ("%04X" % usage_page) if isinstance(usage_page, int) else str(usage_page),
            ("%04X" % usage) if isinstance(usage, int) else str(usage),
            marker,
        ))

    if bruteforce:
        buttons = []
        for i, dev_info in enumerate(unique_devices):
            btn = USBButtonDevice(dev_info["path"], i + 1)
            if btn.connect():
                buttons.append(btn)
        return buttons

    indices_to_open = led_indices if led_indices else list(range(len(unique_devices)))
    buttons = []
    for btn_num, idx in enumerate(indices_to_open):
        if idx < len(unique_devices):
            btn = USBButtonDevice(unique_devices[idx]["path"], btn_num + 1)
            if btn.connect():
                buttons.append(btn)
            else:
                print("  WARNING: Could not open interface %d for button %d" % (idx, btn_num + 1))

    return buttons

# ---------------------------------------------------------------------------
# Multi-button controller
# ---------------------------------------------------------------------------

class PhysicalButton:
    """Represents one physical USBButton with ALL its HID interfaces opened.
    Writes LED commands to ALL interfaces (since we don't know which one
    actually controls the LED). Reads input from all interfaces too."""

    def __init__(self, button_num, interface_devices):
        self.button_num = button_num
        self.devices = interface_devices  # list of USBButtonDevice
        self._last_rgb = None  # track last sent color to avoid redundant writes

    def set_color(self, r, g, b):
        rgb = (int(r), int(g), int(b))
        if rgb == self._last_rgb:
            return  # skip redundant write
        self._last_rgb = rgb
        for dev in self.devices:
            dev.set_color(r, g, b)

    def check_press(self):
        for dev in self.devices:
            data = dev.read_input()
            if data:
                return True
        return False

    def close(self):
        for dev in self.devices:
            dev.set_color(0, 0, 0)
            dev.close()


class ButtonController:
    def __init__(self, bruteforce=False):
        self.physical_buttons = []  # list of PhysicalButton
        self.is_real = False
        self.bruteforce = bruteforce

    def connect(self):
        unique_devices = enumerate_usb_buttons()
        total = len(unique_devices)

        if not unique_devices:
            print("\n  No USBButtons could be opened")
            return False

        print("Found %d USBButton HID interface(s)" % total)
        for i, dev in enumerate(unique_devices):
            iface = dev.get("interface_number", "?")
            usage = dev.get("usage", "?")
            usage_page = dev.get("usage_page", "?")
            marker = " <-- LED" if i in BUTTON_INTERFACES else ""
            print("  [%d] interface=%s usage_page=0x%s usage=0x%s%s" % (
                i, iface,
                ("%04X" % usage_page) if isinstance(usage_page, int) else str(usage_page),
                ("%04X" % usage) if isinstance(usage, int) else str(usage),
                marker,
            ))

        if self.bruteforce:
            buttons = []
            for i, dev_info in enumerate(unique_devices):
                btn = USBButtonDevice(dev_info["path"], i + 1)
                if btn.connect():
                    buttons.append(btn)
            self.physical_buttons = [PhysicalButton(1, buttons)]
            self.is_real = bool(buttons)
            return self.is_real

        for btn_num_0, led_idx in enumerate(BUTTON_INTERFACES):
            start = led_idx
            end = min(led_idx + 4, total)
            devs = []
            for i in range(start, end):
                btn = USBButtonDevice(unique_devices[i]["path"], btn_num_0 + 1)
                if btn.connect():
                    devs.append(btn)
            if devs:
                self.physical_buttons.append(PhysicalButton(btn_num_0 + 1, devs))

        if self.physical_buttons:
            self.is_real = True
            print("\n  %d physical button(s) ready" % len(self.physical_buttons))
            for pb in self.physical_buttons:
                print("    Button %d: %d interface(s) opened" % (pb.button_num, len(pb.devices)))
            return True
        else:
            print("\n  No USBButtons could be opened")
            return False

    def check_button_presses(self):
        """Check all buttons for HID input reports. Returns list of button indices (1-3) that were pressed."""
        pressed = []
        for pb in self.physical_buttons:
            if pb.check_press():
                pressed.append(pb.button_num)
        return pressed

    def set_button_color(self, index, r, g, b):
        for pb in self.physical_buttons:
            if pb.button_num == index:
                pb.set_color(r, g, b)

    def set_all_color(self, r, g, b):
        for pb in self.physical_buttons:
            pb.set_color(r, g, b)

    def close(self):
        for pb in self.physical_buttons:
            pb.close()

    def count(self):
        return len(self.physical_buttons)


class SimulatedController:
    def __init__(self):
        self.is_real = False

    def connect(self):
        print("SIMULATION MODE - No USBButton devices found")
        print("LED values will be printed to console")
        return True

    def set_button_color(self, index, r, g, b):
        pass

    def set_all_color(self, r, g, b):
        pass

    def close(self):
        pass

    def count(self):
        return 3

# ---------------------------------------------------------------------------
# Startup LED test sequence
# ---------------------------------------------------------------------------

def run_led_test(controller):
    print("\n--- LED BRUTEFORCE TEST ---")
    print("Testing %d interface(s), trying ALL write methods on each.\n" % controller.count())
    print("Watch your buttons carefully - note which interface + method lights up!")
    print("Each interface will be tested with RED for 2 seconds.\n")

    for idx in range(1, controller.count() + 1):
        btn = controller.buttons[idx - 1]
        print("\n=== Interface %d ===" % idx)
        print("  Trying all write methods with RED (255, 0, 0)...")
        btn.set_color_bruteforce(255, 0, 0)
        print("  >> Did a button light up? Waiting 2 seconds...")
        time.sleep(2.0)
        print("  Clearing (trying all methods with 0, 0, 0)...")
        btn.set_color_bruteforce(0, 0, 0)
        time.sleep(0.5)

    print("\n--- BRUTEFORCE TEST COMPLETE ---")
    print("If any buttons lit up, note the interface number and which")
    print("method showed 'OK' for that interface. Report back!\n")


def _save_button_interfaces(new_interfaces):
    """Save BUTTON_INTERFACES to the script file and update the global."""
    global BUTTON_INTERFACES
    BUTTON_INTERFACES = list(new_interfaces)
    try:
        import re
        with open(__file__, "r") as f:
            script = f.read()
        script = re.sub(
            r"^BUTTON_INTERFACES\s*=\s*\[.*?\]",
            "BUTTON_INTERFACES = [%d, %d, %d]" % tuple(new_interfaces),
            script,
            count=1,
            flags=re.MULTILINE,
        )
        with open(__file__, "w") as f:
            f.write(script)
        print("  Saved to script: BUTTON_INTERFACES = %s" % list(new_interfaces))
    except Exception as e:
        print("  Could not save to file: %s" % e)
        print("  Active in memory: BUTTON_INTERFACES = %s" % list(new_interfaces))


def run_remap(_ignored=None):
    """Interactive remap mode. Lights up each interface so you can assign
    them to philosopher buttons 1, 2, 3. Works standalone or mid-loop."""
    global BUTTON_INTERFACES

    print("\n--- INTERACTIVE REMAP ---")
    print("This will light up each detected interface one at a time.")
    print("You tell it which philosopher button (1, 2, or 3) that")
    print("physical button should control. Press Enter to skip.\n")

    all_devices = hid.enumerate(ULTIMARC_VENDOR_ID, USBBUTTON_PRODUCT_ID)
    seen_paths = set()
    unique_devices = []
    for dev in all_devices:
        path = dev.get("path", b"")
        if path not in seen_paths:
            seen_paths.add(path)
            unique_devices.append(dev)

    mapping = {}
    total = len(unique_devices)

    for i, dev_info in enumerate(unique_devices):
        btn = USBButtonDevice(dev_info["path"], i + 1)
        if not btn.connect():
            continue

        print("Pulsing interface %d of %d (RED)..." % (i, total - 1))
        for _ in range(6):
            btn.set_color_bruteforce(255, 0, 0)
            time.sleep(0.3)
            btn.set_color_bruteforce(40, 0, 0)
            time.sleep(0.3)

        answer = input("  Which philosopher button is this? (1/2/3, or Enter to skip): ").strip()

        btn.set_color_bruteforce(0, 0, 0)
        btn.close()

        if answer in ("1", "2", "3"):
            slot = int(answer)
            mapping[slot] = i
            print("  -> Mapped philosopher button %d to interface %d\n" % (slot, i))
        else:
            print("  -> Skipped\n")

    if not mapping:
        print("No buttons mapped. Keeping current config.")
        return

    new_interfaces = [
        mapping.get(1, BUTTON_INTERFACES[0] if len(BUTTON_INTERFACES) > 0 else 0),
        mapping.get(2, BUTTON_INTERFACES[1] if len(BUTTON_INTERFACES) > 1 else 4),
        mapping.get(3, BUTTON_INTERFACES[2] if len(BUTTON_INTERFACES) > 2 else 8),
    ]

    print("=" * 40)
    print("New mapping:")
    print("  Philosopher 1 -> interface %d" % new_interfaces[0])
    print("  Philosopher 2 -> interface %d" % new_interfaces[1])
    print("  Philosopher 3 -> interface %d" % new_interfaces[2])
    print()

    confirm = input("Apply this mapping? (y/n): ").strip().lower()
    if confirm == "y":
        _save_button_interfaces(new_interfaces)
    else:
        print("  No changes made.\n")

# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def fetch_led_status(app_url):
    try:
        resp = requests.get("%s/api/led-status" % app_url, timeout=5)
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as e:
        print("  API error: %s" % e)
        return None


def trigger_philosopher(app_url, button_index):
    """Call the server API to trigger the philosopher at the given button index (1-3)."""
    try:
        resp = requests.post(
            "%s/api/trigger-by-index/%d" % (app_url, button_index),
            json={"roomId": 1},
            timeout=10,
        )
        data = resp.json()
        if resp.status_code == 201:
            name = data.get("philosopher", "Unknown")
            print("\n  >>> BUTTON %d PRESSED -> %s speaks! <<<" % (button_index, name))
            return True
        else:
            err = data.get("error", "Unknown error")
            print("\n  >>> BUTTON %d PRESSED -> %s <<<" % (button_index, err))
            return False
    except requests.RequestException as e:
        print("\n  >>> BUTTON %d PRESSED -> API error: %s <<<" % (button_index, e))
        return False


def compute_pulse(confidence, elapsed):
    if confidence < CONFIDENCE_THRESHOLD:
        return 0.0
    wave = (math.sin(elapsed * PULSE_SPEED * math.pi) + 1) / 2
    base = confidence / 100.0
    pulse_range = 1.0 - MIN_PULSE_BRIGHTNESS
    factor = MIN_PULSE_BRIGHTNESS + (pulse_range * wave)
    return base * factor


def run_normal_test(controller):
    """Quick test using only the configured BUTTON_INTERFACES."""
    print("\n--- LED Test (configured buttons) ---")
    colors = [(255, 0, 0), (0, 255, 0), (0, 0, 255)]
    for idx in range(1, controller.count() + 1):
        color = colors[(idx - 1) % len(colors)]
        print("  Button %d -> RGB(%d, %d, %d)" % (idx, color[0], color[1], color[2]))
        controller.set_button_color(idx, *color)
        time.sleep(1.0)
    time.sleep(1.0)
    print("  All off.")
    controller.set_all_color(0, 0, 0)
    print("--- Test Complete ---\n")


def run_diagnose():
    """Test each LED method one at a time so user can identify which one works.
    No network calls needed — purely local hardware test."""
    global WORKING_METHOD

    print("\n" + "=" * 50)
    print("  LED METHOD DIAGNOSTIC")
    print("=" * 50)
    print("  This tests each LED control method individually.")
    print("  Watch your button and note which method lights it up.")
    print("  We'll test with solid RED, then GREEN, then BLUE.\n")

    unique_devices = enumerate_usb_buttons()
    if not unique_devices:
        print("No USBButton devices found!")
        return

    print("Found %d HID interfaces" % len(unique_devices))

    test_iface = BUTTON_INTERFACES[0] if BUTTON_INTERFACES else 0
    print("Testing on interface %d (first configured LED interface)\n" % test_iface)

    if test_iface >= len(unique_devices):
        print("Interface %d not available!" % test_iface)
        return

    btn = USBButtonDevice(unique_devices[test_iface]["path"], 1)
    if not btn.connect():
        print("Could not open device!")
        return

    methods = btn._get_methods(255, 0, 0)
    working = []

    for method_idx in range(len(methods)):
        name = methods[method_idx][0]
        print("--- Method %d: %s ---" % (method_idx, name.split(": ", 1)[1]))

        test_colors = [
            (255, 0, 0, "RED"),
            (0, 255, 0, "GREEN"),
            (0, 0, 255, "BLUE"),
        ]

        for r, g, b, label in test_colors:
            m_list = btn._get_methods(r, g, b)
            _, fn = m_list[method_idx]
            try:
                fn()
                print("  Sent %s (%d,%d,%d) - did it light up %s?" % (label, r, g, b, label))
            except Exception as e:
                print("  FAILED: %s" % e)
                break
            time.sleep(1.5)

        try:
            off_methods = btn._get_methods(0, 0, 0)
            off_methods[method_idx][1]()
        except Exception:
            pass
        time.sleep(0.5)

        answer = input("  Did this method work? (y/n): ").strip().lower()
        if answer == "y":
            working.append(method_idx)
            print("  -> Marked method %d as WORKING\n" % method_idx)
        else:
            print("  -> Skipped\n")

    btn.close()

    print("\n" + "=" * 50)
    if working:
        print("  WORKING METHODS: %s" % working)
        best = working[0]
        print("  Recommended: set WORKING_METHOD = %d in the script" % best)
        confirm = input("  Apply WORKING_METHOD = %d now? (y/n): " % best).strip().lower()
        if confirm == "y":
            WORKING_METHOD = best
            try:
                with open(__file__, "r") as f:
                    script = f.read()
                script = re.sub(
                    r"^WORKING_METHOD\s*=\s*.*$",
                    "WORKING_METHOD = %d" % best,
                    script,
                    count=1,
                    flags=re.MULTILINE,
                )
                with open(__file__, "w") as f:
                    f.write(script)
                print("  Saved WORKING_METHOD = %d to script!" % best)
            except Exception as e:
                print("  Could not save: %s" % e)
                print("  Manually set WORKING_METHOD = %d at top of script." % best)
    else:
        print("  No working methods found on interface %d." % test_iface)
        print("  Try running --diagnose after --remap to check a different interface.")
    print("=" * 50)


def run():
    global BUTTON_INTERFACES
    is_bruteforce = "--test" in sys.argv
    is_remap = "--remap" in sys.argv
    is_diagnose = "--diagnose" in sys.argv

    print("=" * 50)
    print("  CIMC Spirits - USBButton LED Controller")
    print("=" * 50)
    print("  App URL: %s" % APP_URL)
    if is_diagnose:
        print("  Mode: LED DIAGNOSTIC")
    elif is_remap:
        print("  Mode: INTERACTIVE REMAP")
    elif is_bruteforce:
        print("  Mode: BRUTEFORCE TEST")
    else:
        print("  Poll interval: %ss" % POLL_INTERVAL)
        print("  LED interfaces: %s" % BUTTON_INTERFACES)
    print()
    print("  Usage:")
    print("    python %s [url]          Normal mode (poll & pulse)" % sys.argv[0])
    print("    python %s --test         Bruteforce test all interfaces" % sys.argv[0])
    print("    python %s --remap        Interactive button remap" % sys.argv[0])
    print("    python %s --diagnose     Test each LED method individually" % sys.argv[0])
    print()

    if is_diagnose:
        run_diagnose()
        return

    if is_remap:
        controller = ButtonController(bruteforce=True)
        if controller.connect():
            run_remap(controller)
            controller.close()
        else:
            print("No USBButton devices found.")
        return

    print("Scanning for Ultimarc USBButton devices...")
    controller = ButtonController(bruteforce=is_bruteforce)
    if not controller.connect():
        controller = SimulatedController()
        controller.connect()

    if controller.is_real:
        if is_bruteforce:
            run_led_test(controller)
            print("Done. Run with --remap to interactively assign buttons,")
            print("or manually edit BUTTON_INTERFACES in the script.")
            controller.close()
            return
        else:
            run_normal_test(controller)

    start_time = time.time()
    last_status = None
    display_lines = 0
    button_press_times = {}

    print("\nStarting LED control loop...")
    print("  Keys:  1/2/3 = trigger philosopher   r = remap   t = test   s = swap   q = quit")
    print("  USB button presses are also detected automatically.\n")

    old_settings = None
    if not IS_WINDOWS:
        old_settings = termios.tcgetattr(sys.stdin)
    try:
        if not IS_WINDOWS:
            tty.setcbreak(sys.stdin.fileno())

        def _key_available():
            if IS_WINDOWS:
                return msvcrt.kbhit()
            return select.select([sys.stdin], [], [], 0)[0]

        def _read_key():
            if IS_WINDOWS:
                return msvcrt.getch().decode("utf-8", errors="ignore").lower()
            return sys.stdin.read(1).lower()

        def _enter_line_mode():
            if not IS_WINDOWS:
                termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old_settings)

        def _enter_cbreak_mode():
            if not IS_WINDOWS:
                tty.setcbreak(sys.stdin.fileno())

        while True:
            if _key_available():
                key = _read_key()

                if key == "q":
                    break

                elif key == "r":
                    _enter_line_mode()
                    controller.set_all_color(0, 0, 0)
                    controller.close()

                    run_remap(None)

                    controller = ButtonController()
                    if not controller.connect():
                        controller = SimulatedController()
                        controller.connect()
                    display_lines = 0
                    print("\n  Keys:  r = remap   t = test   s = swap   q = quit\n")
                    _enter_cbreak_mode()

                elif key == "t":
                    _enter_line_mode()
                    run_normal_test(controller)
                    display_lines = 0
                    print("\n  Keys:  r = remap   t = test   s = swap   q = quit\n")
                    _enter_cbreak_mode()

                elif key == "s":
                    _enter_line_mode()
                    print("\n--- SWAP TWO BUTTONS ---")
                    print("  Current mapping: %s" % BUTTON_INTERFACES)
                    a = input("  Swap button (1/2/3): ").strip()
                    b = input("  With button (1/2/3): ").strip()
                    if a in ("1","2","3") and b in ("1","2","3") and a != b:
                        ai, bi = int(a)-1, int(b)-1
                        BUTTON_INTERFACES[ai], BUTTON_INTERFACES[bi] = BUTTON_INTERFACES[bi], BUTTON_INTERFACES[ai]
                        _save_button_interfaces(BUTTON_INTERFACES)
                        controller.close()
                        controller = ButtonController()
                        if not controller.connect():
                            controller = SimulatedController()
                            controller.connect()
                        display_lines = 0
                    else:
                        print("  Invalid input, no change.")
                    print("\n  Keys:  r = remap   t = test   s = swap   q = quit\n")
                    _enter_cbreak_mode()

                elif key in ("1", "2", "3"):
                    btn_idx = int(key)
                    print("\n  [keyboard] Triggering philosopher %d..." % btn_idx)
                    trigger_philosopher(APP_URL, btn_idx)
                    display_lines = 0

            if controller.is_real:
                pressed = controller.check_button_presses()
                now = time.time()
                for btn_idx in pressed:
                    last_t = button_press_times.get(btn_idx, 0)
                    if now - last_t > BUTTON_DEBOUNCE:
                        button_press_times[btn_idx] = now
                        print("\n  [USB] Button %d pressed! Triggering philosopher..." % btn_idx)
                        trigger_philosopher(APP_URL, btn_idx)
                        display_lines = 0

            status = fetch_led_status(APP_URL)
            if status:
                last_status = status

            if last_status:
                elapsed = time.time() - start_time
                output_parts = []

                for philosopher in last_status:
                    idx = philosopher.get("index")
                    if idx is None or idx < 1 or idx > controller.count():
                        continue

                    confidence = philosopher.get("confidence", 0)
                    color_hex = philosopher.get("color", "#FFFFFF")
                    name = philosopher.get("name", "Unknown")

                    rgb = hex_to_rgb(color_hex)
                    pulse_factor = compute_pulse(confidence, elapsed)
                    final_rgb = scale_rgb(rgb, pulse_factor)

                    controller.set_button_color(idx, *final_rgb)

                    bar_len = int(confidence / 5)
                    bar = "#" * bar_len + "." * (20 - bar_len)
                    output_parts.append(
                        "  %d. %-24s [%s] %3d%% -> RGB(%3d,%3d,%3d)" % (
                            idx, name, bar, confidence,
                            final_rgb[0], final_rgb[1], final_rgb[2]
                        )
                    )

                if output_parts:
                    if display_lines > 0:
                        sys.stdout.write("\033[2K\033[F" * display_lines)
                    for part in output_parts:
                        print(part)
                    display_lines = len(output_parts)

            time.sleep(POLL_INTERVAL)

    except KeyboardInterrupt:
        pass
    finally:
        if not IS_WINDOWS and old_settings:
            termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old_settings)
        print("\n\nShutting down...")
        controller.close()
        print("LEDs off. Goodbye!")


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        if arg not in ("--test", "--remap", "--diagnose"):
            APP_URL = arg
    run()
