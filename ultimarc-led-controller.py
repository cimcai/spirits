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


def scale_rgb(rgb, factor):
    return tuple(max(0, min(255, int(c * factor))) for c in rgb)

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
        if not self.device:
            return False
        r = max(0, min(255, int(r)))
        g = max(0, min(255, int(g)))
        b = max(0, min(255, int(b)))

        methods = [
            ("feature[0,R,G,B,0]",       lambda: self.device.send_feature_report([0x00, r, g, b, 0x00])),
            ("feature[0,0,R,G,B]",       lambda: self.device.send_feature_report([0x00, 0x00, r, g, b])),
            ("feature[0,1,R,G,B]",       lambda: self.device.send_feature_report([0x00, 0x01, r, g, b])),
            ("write[0,R,G,B]",           lambda: self.device.write([0x00, r, g, b])),
            ("write[0,0,R,G,B]",         lambda: self.device.write([0x00, 0x00, r, g, b])),
            ("write[R,G,B]",             lambda: self.device.write([r, g, b])),
            ("feature[0,R,G,B]",         lambda: self.device.send_feature_report([0x00, r, g, b])),
            ("write[0,1,R,G,B]",         lambda: self.device.write([0x00, 0x01, r, g, b])),
            ("feature[1,R,G,B,0]",       lambda: self.device.send_feature_report([0x01, r, g, b, 0x00])),
            ("write[0,0,0,R,G,B]",       lambda: self.device.write([0x00, 0x00, 0x00, r, g, b])),
            ("feature[0,0,0,R,G,B]",     lambda: self.device.send_feature_report([0x00, 0x00, 0x00, r, g, b])),
        ]

        for name, fn in methods:
            try:
                fn()
                if verbose:
                    print("    [%d] %s -> OK" % (self.index, name))
                return True
            except Exception as e:
                if verbose:
                    print("    [%d] %s -> FAIL: %s" % (self.index, name, e))
        return False

    def set_color_bruteforce(self, r, g, b):
        """Try ALL write methods on this device. Used during testing to find what works."""
        if not self.device:
            return
        r = max(0, min(255, int(r)))
        g = max(0, min(255, int(g)))
        b = max(0, min(255, int(b)))

        methods = [
            ("feature[0,R,G,B,0]",       lambda: self.device.send_feature_report([0x00, r, g, b, 0x00])),
            ("feature[0,0,R,G,B]",       lambda: self.device.send_feature_report([0x00, 0x00, r, g, b])),
            ("feature[0,1,R,G,B]",       lambda: self.device.send_feature_report([0x00, 0x01, r, g, b])),
            ("write[0,R,G,B]",           lambda: self.device.write([0x00, r, g, b])),
            ("write[0,0,R,G,B]",         lambda: self.device.write([0x00, 0x00, r, g, b])),
            ("write[R,G,B]",             lambda: self.device.write([r, g, b])),
            ("feature[0,R,G,B]",         lambda: self.device.send_feature_report([0x00, r, g, b])),
            ("write[0,1,R,G,B]",         lambda: self.device.write([0x00, 0x01, r, g, b])),
            ("feature[1,R,G,B,0]",       lambda: self.device.send_feature_report([0x01, r, g, b, 0x00])),
            ("write[0,0,0,R,G,B]",       lambda: self.device.write([0x00, 0x00, 0x00, r, g, b])),
            ("feature[0,0,0,R,G,B]",     lambda: self.device.send_feature_report([0x00, 0x00, 0x00, r, g, b])),
        ]

        for name, fn in methods:
            try:
                fn()
                print("    [%d] %s -> OK" % (self.index, name))
            except Exception as e:
                print("    [%d] %s -> FAIL: %s" % (self.index, name, e))

    def close(self):
        if self.device:
            try:
                self.device.close()
            except Exception:
                pass
            self.device = None


def find_usb_buttons(led_indices=None, bruteforce=False):
    """Find USBButton devices. If led_indices is provided, only open those
    specific interface indices (0-based). Otherwise open all."""
    devices = hid.enumerate(ULTIMARC_VENDOR_ID, USBBUTTON_PRODUCT_ID)

    seen_paths = set()
    unique_devices = []
    for dev in devices:
        path = dev.get("path", b"")
        if path not in seen_paths:
            seen_paths.add(path)
            unique_devices.append(dev)

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

class ButtonController:
    def __init__(self, bruteforce=False):
        self.buttons = []
        self.is_real = False
        self.bruteforce = bruteforce

    def connect(self):
        if self.bruteforce:
            self.buttons = find_usb_buttons(bruteforce=True)
        else:
            self.buttons = find_usb_buttons(led_indices=BUTTON_INTERFACES)
        if self.buttons:
            self.is_real = True
            print("\n  %d button(s) ready for LED control" % len(self.buttons))
            if not self.bruteforce:
                print("  Mapped to interfaces: %s" % BUTTON_INTERFACES)
            return True
        else:
            print("\n  No USBButtons could be opened")
            return False

    def set_button_color(self, index, r, g, b):
        if 1 <= index <= len(self.buttons):
            self.buttons[index - 1].set_color(r, g, b)

    def set_all_color(self, r, g, b):
        for btn in self.buttons:
            btn.set_color(r, g, b)

    def close(self):
        for btn in self.buttons:
            btn.set_color(0, 0, 0)
            btn.close()

    def count(self):
        return len(self.buttons)


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

        print("Lighting interface %d of %d (WHITE)..." % (i, total - 1))
        btn.set_color(255, 255, 255)
        time.sleep(0.3)

        answer = input("  Which philosopher button is this? (1/2/3, or Enter to skip): ").strip()

        btn.set_color(0, 0, 0)
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
    time.sleep(0.5)
    print("  All white...")
    controller.set_all_color(255, 255, 255)
    time.sleep(1.0)
    print("  Off.")
    controller.set_all_color(0, 0, 0)
    print("--- Test Complete ---\n")


def run():
    global BUTTON_INTERFACES
    is_bruteforce = "--test" in sys.argv
    is_remap = "--remap" in sys.argv

    print("=" * 50)
    print("  CIMC Spirits - USBButton LED Controller")
    print("=" * 50)
    print("  App URL: %s" % APP_URL)
    if is_remap:
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
    print()

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

    print("\nStarting LED control loop...")
    print("  Keys:  r = remap   t = test   s = swap two buttons   q = quit\n")

    old_settings = termios.tcgetattr(sys.stdin)
    try:
        tty.setcbreak(sys.stdin.fileno())

        while True:
            if select.select([sys.stdin], [], [], 0)[0]:
                key = sys.stdin.read(1).lower()

                if key == "q":
                    break

                elif key == "r":
                    termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old_settings)
                    controller.set_all_color(0, 0, 0)
                    controller.close()

                    run_remap(None)

                    controller = ButtonController()
                    if not controller.connect():
                        controller = SimulatedController()
                        controller.connect()
                    display_lines = 0
                    print("\n  Keys:  r = remap   t = test   s = swap   q = quit\n")
                    tty.setcbreak(sys.stdin.fileno())

                elif key == "t":
                    termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old_settings)
                    run_normal_test(controller)
                    display_lines = 0
                    print("\n  Keys:  r = remap   t = test   s = swap   q = quit\n")
                    tty.setcbreak(sys.stdin.fileno())

                elif key == "s":
                    termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old_settings)
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
                    tty.setcbreak(sys.stdin.fileno())

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
        termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old_settings)
        print("\n\nShutting down...")
        controller.close()
        print("LEDs off. Goodbye!")


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        if arg not in ("--test", "--remap"):
            APP_URL = arg
    run()
