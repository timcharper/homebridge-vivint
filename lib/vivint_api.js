const request = require("request-promise-native")
const PubNub = require('pubnub')
const extend = require('util')._extend

function VivintApiModule(config, log) {

  class VivintApi {
    constructor(creds, panelId, cookie, sessionInfo, systemInfo) {
      this.creds = creds
      this.panelId = panelId
      this.cookie = cookie
      this.sessionInfo = sessionInfo
      this.systemInfo = systemInfo
    }

    renew() {
      self = this
      VivintApi.login(creds).then(
        (api) => {
          self.cookie = api.cookie
          self.systemInfo = api.systemInfo
          self.sessionInfo = api.sessionInfo
          self.panelId = api.panelId
        },
        (error) => {
          console.log("error", error)
          setTimeout(() => { renew() }, 5000)
        }
      )
    }

    connectPubNub() {
      let channel = "PlatformChannel#" + this.sessionInfo.u.mbc
      let pubnub = new PubNub({
        subscribeKey : "sub-c-6fb03d68-6a78-11e2-ae8f-12313f022c90"
      })
      pubnub.subscribe({
        channels: [channel]
      })
      return pubnub;
    }

    /**
     * Resource URL to some thing. uri should start with '/'
     */
    getPanelUrl(uri) {
      return "https://vivintsky.com/api/" + this.panelId + "/" + this.systemInfo.system.mnt + uri
    }

    putDevice(category, id, data) {
      return request({
        url: this.getPanelUrl("/" + category + "/" + id),
        method: "PUT",
        body: JSON.stringify(data),
        headers: { Cookie: this.cookie }
      })
    }
  }

  VivintApi.login = (creds) => {
    let loginRequest = request({
      method: "POST",
      url: "https://vivintsky.com/api/login",
      body: JSON.stringify(creds)
    })
    return loginRequest.then((r) => {
      let sessionInfo = JSON.parse(r)
      let cookie = loginRequest.responseContent.headers["set-cookie"][0].split(";")[0]
      let panelId = sessionInfo.u.system[0].panid

      let systemInfo = request({
        "url": "https://vivintsky.com/api/systems/" + panelId,
        "headers": {
          "Cookie": cookie
        }
      })

      return systemInfo.then((sysInfo) => {
        return new VivintApi(creds, panelId, cookie, sessionInfo, JSON.parse(sysInfo))
      })
    })
  }

  return VivintApi;
}

module.exports = VivintApiModule
