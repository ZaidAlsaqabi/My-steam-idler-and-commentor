const crypto = require('crypto');
const fs = require('fs');

// Simple encryption utility for sensitive config data
class ConfigEncryption {
    constructor(masterKey) {
        this.algorithm = 'aes-256-cbc';
        this.masterKey = masterKey || 'your-master-key-change-this';
    }

    // Encrypt text
    encrypt(text) {
        if (!text) return text;
        
        const iv = crypto.randomBytes(16);
        // Use createCipheriv for modern Node.js compatibility
        const key = crypto.scryptSync(this.masterKey, 'salt', 32);
        const cipher = crypto.createCipheriv(this.algorithm, key, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        return iv.toString('hex') + ':' + encrypted;
    }

    // Decrypt text
    decrypt(encryptedText) {
        if (!encryptedText || !encryptedText.includes(':')) return encryptedText;
        
        try {
            const parts = String(encryptedText).split(':');
            const iv = Buffer.from(parts[0], 'hex');
            const encrypted = parts.slice(1).join(':');
            
            // Use createDecipheriv for modern Node.js compatibility
            const key = crypto.scryptSync(this.masterKey, 'salt', 32);
            const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
            let decrypted = decipher.update(encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            
            return decrypted;
        } catch (error) {
            console.error('Decryption failed:', error.message);
            return encryptedText; // Return original if decryption fails
        }
    }

    // Check if text is encrypted (ivhex:cipherhex)
    isEncrypted(text) {
        return typeof text === 'string' && /^[0-9a-f]{32}:[0-9a-f]+$/i.test(text.trim());
    }

    encryptFileIfPlain(filePath) {
        if (!fs.existsSync(filePath)) return 'missing';
        const raw = fs.readFileSync(filePath, 'utf8').trim();
        if (!raw) return 'empty';
        if (this.isEncrypted(raw)) return 'already';
        fs.writeFileSync(filePath, this.encrypt(raw), { encoding: 'utf8' });
        return 'encrypted';
    }

    secretsForDisk(configObj) {
        const toWrite = JSON.parse(JSON.stringify(configObj));
        if (toWrite.username && !this.isEncrypted(toWrite.username)) {
            toWrite.username = this.encrypt(toWrite.username);
        }
        if (toWrite.password && !this.isEncrypted(toWrite.password)) {
            toWrite.password = this.encrypt(toWrite.password);
        }
        return toWrite;
    }

    unlockSecrets(configObj) {
        if (configObj.username && this.isEncrypted(configObj.username)) {
            configObj.username = this.decrypt(configObj.username);
        }
        if (configObj.password && this.isEncrypted(configObj.password)) {
            configObj.password = this.decrypt(configObj.password);
        }
        return configObj;
    }

    persistEncryptedConfig(filePath, configObj) {
        const toWrite = this.secretsForDisk(configObj);
        fs.writeFileSync(filePath, JSON.stringify(toWrite, null, 4));
        return toWrite;
    }

    encryptConfigAtRuntime(filePath, configObj) {
        const needsEncrypt =
            (configObj.username && !this.isEncrypted(configObj.username)) ||
            (configObj.password && !this.isEncrypted(configObj.password));
        if (needsEncrypt) {
            this.persistEncryptedConfig(filePath, configObj);
            return 'encrypted';
        }
        return 'already';
    }
}

module.exports = ConfigEncryption;
