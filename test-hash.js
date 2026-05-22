const argon2 = require('argon2');

async function test() {
    const password = 'omega1977';
    
    // Générer nouveau hash
    const hash = await argon2.hash(password);
    console.log('NOUVEAU HASH:', hash);
    
    // Vérifier
    const isValid = await argon2.verify(hash, password);
    console.log('Vérification:', isValid);
}
test();
