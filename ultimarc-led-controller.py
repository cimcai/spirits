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

    def set_color(self, r, g, b):
        if not self.device:
            return False
        r = max(0, min(255, int(r)))
        g = max(0, min(255, int(g)))
        b = max(0, min(255, int(b)))
        try:
            report = [0x00, 0x00, 0x00, 0x00, 0x00]
            report[1] = r
            report[2] = g
            report[3] = b
            self.device.send_feature_report(report)
            return True
        except Exception:
            pass
        try:
            report = [0x00, r, g, b]
            self.device.write(report)
            return True
        except Exception:
            pass
        try:
            report = [0x00, 0x01, r, g, b]
            self.device.send_feature_report(report)
            return True
        except Exception as e:
            print("  Button %d: Write error - %s" % (self.index, e))
            return False

    def close(self):
        if self.device:
            try:
                self.device.close()
            except Exception:
                pass
            self.device = None


def find_usb_buttons():
    devices = hid.enumerate(ULTIMARC_VENDOR_ID, USBBUTTON_PRODUCT_ID)

    seen_paths = set()
    unique_devices = []
    for dev in devices:
        path = dev.get("path", b"")
        if path not in seen_paths:
            seen_paths.add(path)
            unique_devices.append(dev)

    print("Found %d USBButton HID interface(s)" % len(unique_devices))

    buttons = []
    for i, dev_info in enumerate(unique_devices):
        btn = USBButtonDevice(dev_info["path"], i + 1)
        if btn.connect():
            buttons.append(btn)
        if len(buttons) >= 3:
            break

    return buttons

# ---------------------------------------------------------------------------
# Multi-button controller
# ---------------------------------------------------------------------------

class ButtonController:
    def __init__(self):
        self.buttons = []
        self.is_real = False

    def connect(self):
        self.buttons = find_usb_buttons()
        if self.buttons:
            self.is_real = True
            print("\n  %d USBButton(s) ready for control" % len(self.buttons))
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
    print("\n--- LED Test Sequence ---")
    print("Cycling colors on %d button(s)...\n" % controller.count())

    test_colors = [
        ("Red",     255, 0,   0),
        ("Green",   0,   255, 0),
        ("Blue",    0,   0,   255),
        ("Yellow",  255, 255, 0),
        ("Cyan",    0,   255, 255),
        ("Magenta", 255, 0,   255),
        ("White",   255, 255, 255),
    ]

    hold_time = 0.5
    fade_steps = 10
    fade_time = 0.03

    for color_name, r, g, b in test_colors:
        print("  %s" % color_name)
        for step in range(fade_steps):
            factor = (step + 1) / fade_steps
            controller.set_all_color(
                int(r * factor),
                int(g * factor),
                int(b * factor),
            )
            time.sleep(fade_time)
        time.sleep(hold_time)

    print("\n  Chase pattern...")
    chase_colors = [
        (255, 0, 0),
        (0, 255, 0),
        (0, 0, 255),
    ]
    for _round in range(3):
        for idx in range(1, controller.count() + 1):
            for other_idx in range(1, controller.count() + 1):
                if other_idx == idx:
                    color = chase_colors[(idx - 1) % len(chase_colors)]
                    controller.set_button_color(other_idx, *color)
                else:
                    controller.set_button_color(other_idx, 0, 0, 0)
            time.sleep(0.2)

    print("  Fading out...\n")
    for step in range(fade_steps, -1, -1):
        factor = step / fade_steps
        controller.set_all_color(
            int(255 * factor),
            int(255 * factor),
            int(255 * factor),
        )
        time.sleep(fade_time)

    print("--- LED Test Complete ---")
    print("If you saw colors cycle on your buttons, hardware is working!\n")

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


def run():
    print("=" * 50)
    print("  CIMC Spirits - USBButton LED Controller")
    print("=" * 50)
    print("  App URL: %s" % APP_URL)
    print("  Poll interval: %ss" % POLL_INTERVAL)
    print()

    print("Scanning for Ultimarc USBButton devices...")
    controller = ButtonController()
    if not controller.connect():
        controller = SimulatedController()
        controller.connect()

    if controller.is_real:
        run_led_test(controller)

    start_time = time.time()
    last_status = None

    print("\nStarting LED control loop (Ctrl+C to stop)...\n")

    try:
        while True:
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
                    sys.stdout.write("\033[2K\033[F" * len(output_parts))
                    for part in output_parts:
                        print(part)

            time.sleep(POLL_INTERVAL)

    except KeyboardInterrupt:
        print("\n\nShutting down...")
        controller.close()
        print("LEDs off. Goodbye!")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        APP_URL = sys.argv[1]
    run()
