# @balansse/Homebridge-Vivint

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
* PIV Motion Detectors (Each Vivint camera doubles as a motion detector - piv meaning 'person in view')
* Tilt sensors
* Fire alert sensors
* Glass break sensors
* Added 'low battery' indicator to each wireless sensor
* Added battery service to all wireless locks and sensors so homekit will show actual battery level
* Z-Wave switches (binary and dimmer) that are paired with the vivint panel. Be sure they are labeled "light" or "fan" if they control those respective devices.

Support for adding additional devices is relatively trivial. Please open a PR if you'd like to see more!

## Configuration

Configuration of the plugin is simple. The Vivint plugin is a dynamic platform which caches the accessories registered.

Configuration sample:

    {
      "platform": "Vivint",
      "username": "your-vivint-user@email.com",
      "password": "vivint-user-password",
      "apiLoginRefreshSecs": 1200,
      "lowbatterylevel": 15,
      "ignoreDeviceTypes": ["thermostat_device", "garage_door_device"]
    }

A general recommendation: consider creating and using a new Vivint account named "Apple Home". This way, your Vivint logs will show "the front door was unlocked by Apple Home", etc.

Configuration options overview:

* **username**
* **password**
* **apiLoginRefreshSecs** - How often should Vivint Homebridge renew the session token? The token that Vivint provides when authenticating will expire. Also, when this renewal occurs, the plugin requests another snapshot. The event stream can sometimes fail to report device state appropriately and events can come out of order with the snapshot, or updates can be missed entirely. The occasional snapshot retrieval will auto-correct any such errors. Avoid setting this any more frequent that 10 minutes.
* **motionDetectedOccupancySensorMins** - Homebridge-vivint will create occupancy sensors for motion sensors that will stay active for X minutes after a motion event is detected. This value configures for how long that occupancy sensor will stay active if no further motion events are detected. Note: Vivint's reporting of motion events over the event stream can be a little inconsistent, at times. As a recommendation, don't plan on creating Homekit automations that respond to Vivint motion events.
* **lowbatterylevel** - How low the battery level should be before the plugin reports to HomeKit that the battery is low.
* **ignoreDeviceTypes** - The array containing the device types that should be ignored. Allowed types: "primary_touch_link_device", "thermostat_device", "door_lock_device", "garage_door_device", "camera_device", "wireless_sensor"
