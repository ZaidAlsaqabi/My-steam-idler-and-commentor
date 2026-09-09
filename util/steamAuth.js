const fs = require('fs');
const { LoginSession, EAuthTokenPlatformType, EAuthSessionGuardType, ESessionPersistence } = require('steam-session');

const TOKEN_PATH = './config/steam-refresh.token';

function decodeJwtPayload(token) {
    try {
        const part = String(token).split('.')[1];
        if (!part) return null;
        const padded = part.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((part.length + 3) % 4);
        return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    } catch (_) {
        return null;
    }
}

function tokenExpiry(token) {
    const payload = decodeJwtPayload(token);
    if (!payload || !payload.exp) return null;
    return new Date(payload.exp * 1000);
}

function isTokenExpired(token, skewMs = 60 * 1000) {
    const exp = tokenExpiry(token);
    return !!(exp && exp.getTime() <= Date.now() + skewMs);
}

function createSteamAuth(encryption) {
    function ensureTokenEncrypted() {
        return encryption.encryptFileIfPlain(TOKEN_PATH);
    }

    function readToken() {
        try {
            const raw = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
            if (!raw) return null;
            if (encryption.isEncrypted(raw)) {
                const decrypted = encryption.decrypt(raw);
                if (!decrypted || encryption.isEncrypted(decrypted)) {
                    console.log("Could not decrypt saved Steam session. You may need to authenticate again.");
                    return null;
                }
                return decrypted;
            }
            const status = ensureTokenEncrypted();
            if (status === 'encrypted') {
                console.log("Encrypted saved Steam session token.");
            }
            return raw;
        } catch (_) {
            return null;
        }
    }

    function saveToken(token) {
        if (!token) return;
        fs.writeFileSync(TOKEN_PATH, encryption.encrypt(token), { encoding: 'utf8' });
        const exp = tokenExpiry(token);
        if (exp) {
            console.log("Saved encrypted Steam session. You will not need an authenticator code again until " + exp.toLocaleString() + ".");
        } else {
            console.log("Saved encrypted Steam session. You will not need an authenticator code on the next start.");
        }
    }

    function clearToken() {
        try {
            fs.unlinkSync(TOKEN_PATH);
        } catch (_) {}
    }

    function getSavedToken() {
        const token = readToken();
        if (!token) return null;
        if (isTokenExpired(token)) {
            console.log("Saved Steam session expired. You will need to authenticate once more.");
            clearToken();
            return null;
        }
        return token;
    }

    async function loginWithCredentials(accountName, password, askCode) {
        const session = new LoginSession(EAuthTokenPlatformType.SteamClient);

        const authenticated = new Promise((resolve, reject) => {
            session.once('authenticated', () => resolve(session.refreshToken));
            session.once('error', reject);
            session.once('timeout', () => reject(new Error('Steam login timed out')));
        });

        const result = await session.startWithCredentials({
            accountName,
            password,
            persistence: ESessionPersistence.Persistent
        });

        if (result.actionRequired) {
            const actions = result.validActions || [];
            const email = actions.find((a) => a.type === EAuthSessionGuardType.EmailCode);
            const needsCode = actions.some((a) => (
                a.type === EAuthSessionGuardType.DeviceCode || a.type === EAuthSessionGuardType.EmailCode
            ));
            const needsAppConfirm = actions.some((a) => (
                a.type === EAuthSessionGuardType.DeviceConfirmation || a.type === EAuthSessionGuardType.EmailConfirmation
            ));

            if (needsAppConfirm) {
                console.log("You can also approve this login in the Steam mobile app.");
            }

            if (needsCode) {
                const prompt = email
                    ? ("Steam Guard email code (" + email.detail + "): ")
                    : "Steam Authenticator Code: ";
                let lastWrong = false;
                for (let attempt = 0; attempt < 5; attempt++) {
                    if (lastWrong) {
                        console.log("That code was incorrect or already used. Waiting 30s for a new one...");
                        await new Promise((r) => setTimeout(r, 30000));
                    }
                    const code = (await askCode(prompt)).trim();
                    try {
                        await session.submitSteamGuardCode(code);
                        lastWrong = false;
                        break;
                    } catch (err) {
                        const mismatch = err && (err.eresult === 88 || err.eresult === 65 || /Mismatch|InvalidLoginAuthCode/i.test(err.message || ''));
                        if (mismatch && attempt < 4) {
                            lastWrong = true;
                            continue;
                        }
                        throw err;
                    }
                }
            }
        }

        const token = await authenticated;
        saveToken(token);
        return token;
    }

    async function getRefreshToken(accountName, password, askCode) {
        const saved = getSavedToken();
        if (saved) {
            const exp = tokenExpiry(saved);
            if (exp) {
                console.log("Using saved Steam session (valid until " + exp.toLocaleString() + "). No authenticator code needed.");
            } else {
                console.log("Using saved Steam session. No authenticator code needed.");
            }
            return saved;
        }

        console.log("First-time Steam login. Enter your authenticator code once; it will be remembered.");
        try {
            return await loginWithCredentials(accountName, password, askCode);
        } catch (err) {
            if (err && (err.eresult === 84 || err.message === 'RateLimitExceeded')) {
                const wrapped = new Error('RateLimitExceeded');
                wrapped.eresult = 84;
                throw wrapped;
            }
            throw err;
        }
    }

    return {
        TOKEN_PATH,
        readToken,
        saveToken,
        clearToken,
        getSavedToken,
        getRefreshToken,
        tokenExpiry,
        ensureTokenEncrypted
    };
}

module.exports = createSteamAuth;
