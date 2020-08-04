# @balansse/Homebridge-Vivint

[![npm](https://badgen.net/npm/v/@balansse/homebridge-vivint) ![npm](https://badgen.net/npm/dt/@balansse/homebridge-vivint)](https://www.npmjs.com/package/@balansse/homebridge-vivint) [![Donate](https://img.shields.io/badge/Donate-PayPal-blue.svg)](https://www.paypal.com/cgi-bin/webscr?cmd=_donations&business=6NDY338ETGK4Q&currency_code=USD&source=url)

## Overview

This is a fork of [homebridge-vivint](https://github.com/timcharper/homebridge-vivint) plugin for [homebridge](https://github.com/nfarina/homebridge).
It allows to use your Vivint SmartHome products in Apple Homekit. The main changes in this fork include:
  * Ignore list for specific device types managed by Vivint (useful in case of external integrations like Nest or MyQ that may be managed directly by another plugin) 
  * Dynamic accessory cache management - any accessories that are no longer managed by the plugin or are disconnected from Vivint system would be removed from the cache automatically
  * Homebridge Config UI X Web UI settings support.

Homebridge-Vivint was written by a former Vivint employee, Tim Harper. This project is not officially endorsed, sponsored, or affiliated with Vivint SmartHome in any way.

## Supported Items

Currently, the following items are supported:

* Locks
* Contact sensors
* Thermostat
* Motion sensors
* Garage Door Opener
* Alarm Panel (arm home/away, disarm)
* PIV Motion Detectors (Each Vivint camera doubles as a motion detector - PIV meaning 'person in view')
  * [homebridge-camera-ffmpeg](https://github.com/Sunoo/homebridge-camera-ffmpeg) plugin is required to display video from cameras in HomeKit. **showCameraConfig** config flag can be used to generate config for each detected camera. Copy each config from the log into the "cameras" section of the [homebridge-camera-ffmpeg](https://github.com/Sunoo/homebridge-camera-ffmpeg) plugin configuration for cameras to appear in HomeKit.
* Tilt sensors
* Fire alert sensors
* Glass break sensors
* Z-Wave switches (binary and dimmer) that are paired with the Vivint panel. Be sure they are labeled "light" or "fan" if they control those respective devices.

As I do not have access to all varieties of hardware that is supported by Vivint, some incompatibilities might happen. If you notice any weird behavior or your Vivint device is not supported, please submit an issue with your homebridge.log file attached.

## Configuration

Configuration of the plugin is simple. The Vivint plugin is a dynamic platform which caches the accessories registered.

Configuration sample:

    {
      "platform": "Vivint",
      "username": "your-vivint-user@email.com",
      "password": "vivint-user-password",
      "apiLoginRefreshSecs": 1200,
      "ignoreDeviceTypes": ["thermostat_device", "garage_door_device"],
      "showCameraConfig": true
    }

A general recommendation: consider creating and using a new Vivint account named "Apple Home". This way, your Vivint logs will show "the front door was unlocked by Apple Home", etc.

Configuration options overview:

* **username**
* **password**
* **apiLoginRefreshSecs** - How often should Vivint Homebridge renew the session token? The token that Vivint provides when authenticating will expire. Also, when this renewal occurs, the plugin requests another snapshot. The event stream can sometimes fail to report device state appropriately and events can come out of order with the snapshot, or updates can be missed entirely. The occasional snapshot retrieval will auto-correct any such errors. Avoid setting this any more frequent that 10 minutes.
* **motionDetectedOccupancySensorMins** - Homebridge-vivint will create occupancy sensors for motion sensors that will stay active for X minutes after a motion event is detected. This value configures for how long that occupancy sensor will stay active if no further motion events are detected. Note: Vivint's reporting of motion events over the event stream can be a little inconsistent, at times. As a recommendation, don't plan on creating Homekit automations that respond to Vivint motion events.
* **ignoreDeviceTypes** - The array containing the device types that should be ignored. Allowed types: "primary_touch_link_device", "thermostat_device", "door_lock_device", "garage_door_device", "camera_device", "wireless_sensor"
* **showCameraConfig** - Log [homebridge-camera-ffmpeg](https://github.com/Sunoo/homebridge-camera-ffmpeg) configuration for all detected cameras.
