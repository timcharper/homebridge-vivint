const request = require("request-promise-native");

const VIVINT_LOGIN_URL = 'https://www.vivintsky.com/api/login';
const VIVINT_AUTHUSER_URL = 'https://www.vivintsky.com/api/authuser';
const VIVINT_MFA_URL = 'https://www.vivintsky.com/platform-user-api/v0/platformusers/2fa/validate';

class VivintMFA {
    constructor() {
        this.using2fa = false;
        this.promptFor2fa = 'Please enter the code sent to your text/email';
        this.cookie = "";
    }
    async MFALogin(email, password) {
        try {
            //Make request to Login URL to get initial cookie.
            const loginResponse = await request({
                method: "POST",
                url: VIVINT_LOGIN_URL,
                body: {
                    username: email,
                    password: password
                },
                json: true,
                resolveWithFullResponse: true
            });
            //console.log("loginResponse = " + JSON.stringify(loginResponse, null, 4));
            this.cookie = loginResponse.headers["set-cookie"][0].split(";")[0];
            //Make request to the Authuser URL to trigger MFA token to send
            const authResponse = await request({
                method: "GET",
                url: VIVINT_AUTHUSER_URL,
                headers: { Cookie: this.cookie },
                json: true,
                resolveWithFullResponse: true,
                simple: false //This allows us to receive a response even if it failed with 401 etc.
            });
            //console.log("authResponse = " + JSON.stringify(authResponse, null, 4));
            this.cookie = authResponse.headers["set-cookie"][0].split(";")[0];
            //console.log("cookie = " + this.cookie);
            if (authResponse.statusCode === 401) {
                this.using2fa = true;
            }
            //return cookie;
        } catch (error) {
            console.error("Error in MFALogin", error);
            throw error;
        }
        return this.cookie;
    };

    async MFAValidateCode(cookie, code) {
        try {
            const MFAValidateCodeResponse = await request({
                method: "POST",
                url: VIVINT_MFA_URL,
                headers: { Cookie: cookie },
                body: { code: code },
                json: true,
                resolveWithFullResponse: true
            });
            return MFAValidateCodeResponse;
        } catch (error) {
            console.log("Error in MFAValidateCode", error);
            throw error;
        }
    }
}

exports.VivintMFA = VivintMFA;