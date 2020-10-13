const Device = require('../device.js')
const VivintDict = require("../vivint_dictionary.json")
const request = require("request-promise-native")

class Camera extends Device {
    constructor(accessory, data, config, log, homebridge, vivintApi) {
        super(accessory, data, config, log, homebridge, vivintApi)

        this.config_cameraAutomationHttpPort = config.cameraAutomationHttpPort || null

      this.service = accessory.getService(this.Service.MotionSensor)

      this.service
        .getCharacteristic(this.Characteristic.MotionDetected)
        .on('get', callback => callback(null, this.getMotionDetectedState()))

      //If "Show Camera Config" is enabled, show config for camera in log
      let config_showCameraConfig = config.showCameraConfig || false
      if (config_showCameraConfig == true) {

        let source = data.CameraInternalURL[0].replace('rtsp://',`rtsp://${vivintApi.panelLogin.Name}:${vivintApi.panelLogin.Password}@`)

        let informationService = accessory.getService(this.Service.AccessoryInformation)
        var cameraConfigObject = {
          name: data.Name,
          manufacturer: informationService.getCharacteristic(this.Characteristic.Manufacturer).value,
          model: informationService.getCharacteristic(this.Characteristic.Model).value,
          motion: true,
          motionTimeout: 1
        }

        if (data.Name.toLowerCase().indexOf('doorbell') > -1) {
          cameraConfigObject.doorbell = true
        }

        cameraConfigObject.videoConfig = {
          source: `-rtsp_transport tcp -re -i ${source}`,
          vcodec: 'copy',
          audio: true
        }

        log.info(`Camera [${data.Name}] configuration:`, JSON.stringify(cameraConfigObject, undefined, 4))
      }

      this.notify()
    }

    getMotionDetectedState() {
      return Boolean(this.data.PersonInView) || Boolean(this.data.VisitorDetected)
    }

    getDoorbellButtonPress() {
      return Boolean(this.data.DingDong)
    }

    async notify() {
      if (this.service) {

        if (this.getDoorbellButtonPress() && this.config_cameraAutomationHttpPort !== null){
          try {
            await request({
              method: "GET",
              url: `http://[::1]:${this.config_cameraAutomationHttpPort}/doorbell?${this.name}`
            })
          }
          catch (err) {
            log.error('Error occured on camera automation HTTP call', err.message)
            log.debug(err)
          }
        }

        let motionDetected = this.getMotionDetectedState()
        this.service.updateCharacteristic(this.Characteristic.MotionDetected, motionDetected)
        if (motionDetected && this.config_cameraAutomationHttpPort !== null) {
          try {
            await request({
              method: "GET",
              url: `http://[::1]:${this.config_cameraAutomationHttpPort}/motion?${this.name}`
            })
          }
          catch (err) {
            log.error('Error occured on camera automation HTTP call', err.message)
            log.debug(err)
          }
        }

        if (this.data.VisitorDetected) {
          // the doorbell uses the flag "VisitorDetected" and doesn't reset itself for some reason
          setTimeout(() => {
            this.service.updateCharacteristic(this.Characteristic.MotionDetected, 0)
            this.data.VisitorDetected = 0
          }, 5000)
        }
      }
    }

    static appliesTo(data) {
      return (data.Type == VivintDict.PanelDeviceType.Camera)
    }

    static inferCategory(data, Accessory) {
      let name = data.Name

      if (name.toLowerCase().indexOf('doorbell') > -1)
        return Accessory.Categories.VIDEO_DOORBELL
      else
        return Accessory.Categories.IP_CAMERA
    }

    static addServices(accessory, Service) {
      accessory.addService(new Service.MotionSensor(accessory.context.name + " PIV Detector"))
    }
  }

  module.exports = Camera