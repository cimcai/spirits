#!/usr/bin/env python3
"""
Ultimarc LED Controller for Philosophical Insight

Polls the /api/led-status endpoint and pulses Ultimarc USB button LEDs
based on philosopher confidence levels.

Supports: PacLED64, I-PAC Ultimate I/O, PacDrive

SETUP:
  1. pip install hidapi requests
  2. Configure APP_URL below to point to your running app
  3. Configure LED_MAP to match your button wiring
  4. Run: python ultimarc-led-controller.py [optional-app-url]

HID PROTOCOL NOTE:
  The HID write format [0, channel, brightness] works for PacLED64.
  Your Ultimarc board may need a different report structure.
  If LEDs don't respond, check your board's SDK documentation and
  update the set_led_brightness() method accordingly.
  The script runs in simulation mode if no hardware is detected.

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
# CONFIGURATION - Edit these to match your setup
# ---------------------------------------------------------------------------

APP_URL = "https://your-replit-app-url.replit.app"

POLL_INTERVAL = 1.0

ULTIMARC_VENDOR_ID = 0xD209

ULTIMARC_PRODUCT_IDS = [
    0x1401,  # PacLED64
    0x0301,  # I-PAC Ultimate I/O
    0x0002,  # PacDrive
]

LED_MAP = {
    1: {"channels": [1, 2, 3]},    # Philosopher 1 (Stoic) - LED channels for R, G, B
    2: {"channels": [4, 5, 6]},    # Philosopher 2 (Existentialist)
    3: {"channels": [7, 8, 9]},    # Philosopher 3 (Socratic)
}

PULSE_SPEED = 2.0
MIN_PULSE_BRIGHTNESS = 0.2
CONFIDENCE_THRESHOLD = 50

# ---------------------------------------------------------------------------
# Color parsing
# ---------------------------------------------------------------------------

def hex_to_rgb(hex_color):
    hex_color = hex_color.lstrip("#")
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))


def scale_rgb(rgb, factor):
    return tuple(max(0, min(255, int(c * factor))) for c in rgb)

# ---------------------------------------------------------------------------
# Ultimarc HID communication
# ---------------------------------------------------------------------------

class UltimarcDevice:
    def __init__(self):
        self.device = None
        self.product_id = None

    def connect(self):
        for pid in ULTIMARC_PRODUCT_IDS:
            try:
                self.device = hid.device()
                self.device.open(ULTIMARC_VENDOR_ID, pid)
                self.product_id = pid
                name = self.device.get_product_string() or f"PID 0x{pid:04X}"
                print(f"Connected to Ultimarc device: {name}")
                return True
            except Exception:
                self.device = None
                continue
        return False

    def set_led_brightness(self, channel, brightness):
        if not self.device:
            return
        brightness = max(0, min(255, int(brightness)))
        try:
            self.device.write([0, channel, brightness])
        except Exception as e:
            print(f"  HID write error (ch {channel}): {e}")
            self.device = None

    def set_led_rgb(self, channels, r, g, b):
        if len(channels) >= 3:
            self.set_led_brightness(channels[0], r)
            self.set_led_brightness(channels[1], g)
            self.set_led_brightness(channels[2], b)
        elif len(channels) == 1:
            gray = int(0.299 * r + 0.587 * g + 0.114 * b)
            self.set_led_brightness(channels[0], gray)

    def close(self):
        if self.device:
            try:
                self.device.close()
            except Exception:
                pass
            self.device = None

# ---------------------------------------------------------------------------
# Simulation mode (no hardware)
# ---------------------------------------------------------------------------

class SimulatedDevice:
    def connect(self):
        print("SIMULATION MODE - No Ultimarc device found")
        print("LED values will be printed to console")
        return True

    def set_led_brightness(self, channel, brightness):
        pass

    def set_led_rgb(self, channels, r, g, b):
        pass

    def close(self):
        pass

# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def fetch_led_status():
    try:
        resp = requests.get(f"{APP_URL}/api/led-status", timeout=5)
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as e:
        print(f"  API error: {e}")
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
    print("  Ultimarc LED Controller")
    print("  Philosophical Insight")
    print("=" * 50)
    print(f"  App URL: {APP_URL}")
    print(f"  Poll interval: {POLL_INTERVAL}s")
    print(f"  LED map: {json.dumps(LED_MAP, indent=2)}")
    print()

    device = UltimarcDevice()
    if not device.connect():
        print("No Ultimarc hardware detected.")
        device = SimulatedDevice()
        device.connect()

    start_time = time.time()
    last_status = None

    print("\nStarting LED control loop (Ctrl+C to stop)...\n")

    try:
        while True:
            status = fetch_led_status()
            if status:
                last_status = status

            if last_status:
                elapsed = time.time() - start_time
                output_parts = []

                for philosopher in last_status:
                    idx = philosopher["index"]
                    confidence = philosopher["confidence"]
                    color_hex = philosopher["color"]
                    name = philosopher["name"]

                    if idx not in LED_MAP:
                        continue

                    rgb = hex_to_rgb(color_hex)
                    pulse_factor = compute_pulse(confidence, elapsed)
                    final_rgb = scale_rgb(rgb, pulse_factor)

                    channels = LED_MAP[idx]["channels"]
                    device.set_led_rgb(channels, *final_rgb)

                    bar_len = int(confidence / 5)
                    bar = "#" * bar_len + "." * (20 - bar_len)
                    output_parts.append(
                        f"  {idx}. {name:<24} [{bar}] {confidence:3d}% -> RGB({final_rgb[0]:3d},{final_rgb[1]:3d},{final_rgb[2]:3d})"
                    )

                sys.stdout.write("\033[2K\033[F" * len(output_parts))
                for part in output_parts:
                    print(part)

            time.sleep(POLL_INTERVAL)

    except KeyboardInterrupt:
        print("\n\nShutting down...")
        for idx, mapping in LED_MAP.items():
            device.set_led_rgb(mapping["channels"], 0, 0, 0)
        device.close()
        print("LEDs off. Goodbye!")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        APP_URL = sys.argv[1]
    run()
