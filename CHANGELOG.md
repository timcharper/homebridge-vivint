#### 1.0.0 (2020-09-10)

### Changes

- Add support for new devices:
    - CO detector
    - Smoke detector
    - Heat / Freeze sensors
- "Jammed" state support for locks
- Ability to change panel states between Stay and Away while armed

#### 0.0.13 (2020-08-11)

### Bug Fixes

- Fixed Panel arm/disarm notification lag

#### 0.0.11 (2020-08-02)

### Bug Fixes

- Fixed thermostat handling

##### Other Changes

- More accurate security panel status mapping

#### 0.0.10 (2020-07-31)

### Changes

- Use Vivint battery management for Low Battery states
- Added an option to display camera config in the log file to be used with [homebridge-camera-ffmpeg](https://github.com/Sunoo/homebridge-camera-ffmpeg) plugin

#### 0.0.9 (2020-07-14)

### Changes

- Add support for new devices:
    - Glass Break
    - Fire Alert
    - Tilt sensor
    - Third party motion detectors
    - Third party contact sensors

### Bug Fixes

- Report battery level as 100 in case it is not reported

#### 0.0.8 (2020-07-09)

### Bug Fixes

- Default contact sensor battery value to 100% when unknown

#### 0.0.7 (2020-06-26)

### Changes

- Increase stability of event stream;
- Dynamically add and remove accessories;
- Remove excessive logging;
- Add object mapping using dictionary;