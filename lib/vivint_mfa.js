const request = require("request-promise-native");

const VIVINT_LOGIN_URL = 'https://www.vivintsky.com/api/login';
const VIVINT_AUTHUSER_URL = 'https://www.vivintsky.com/api/authuser';
const VIVINT_MFA_URL = 'https://www.vivintsky.com/platform-user-api/v0/platformusers/2fa/validate';

class VivintMFA {
    constructor() {
        this.using2fa = false;
        this.promptFor2fa = 'Please enter the code sent to your text/email';
        this.refreshToken = "";
    }
    async MFALogin(email, password) {
        try {
            //Make request to Login URL to get initial refreshToken.
            const loginResponse = await request({
                method: "POST",
                url: VIVINT_LOGIN_URL,
                body: {
                    username: email,
                    password: password,
                    "persist_session": true //sets refreshToken timeout to 1 month instead of 20 minutes
                },
                json: true,
                resolveWithFullResponse: true
            });
            //console.log("loginResponse = " + JSON.stringify(loginResponse, null, 4));
            this.refreshToken = loginResponse.headers["set-cookie"][0].split(";")[0];
            //Make request to the Authuser URL to trigger MFA token to send
            const authResponse = await request({
                method: "GET",
                url: VIVINT_AUTHUSER_URL,
                headers: { Cookie: this.refreshToken },
                json: true,
                resolveWithFullResponse: true,
                simple: false //This allows us to receive a response even if it failed with 401 etc.
            });
            //console.log("authResponse = " + JSON.stringify(authResponse, null, 4));
            this.refreshToken = authResponse.headers["set-cookie"][0].split(";")[0];
            //console.log("refreshToken = " + this.refreshToken);
            if (authResponse.statusCode === 401) {
                this.using2fa = true;
            }
        } catch (error) {
            console.error("Error in MFALogin", error);
            throw error;
        }
        return this.refreshToken;
    };

    async MFAValidateCode(refreshToken, code) {
        try {
            const MFAValidateCodeResponse = await request({
                method: "POST",
                url: VIVINT_MFA_URL,
                headers: { Cookie: refreshToken },
                body: {
                    code: code,
                    "persist_session": true
                },
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
