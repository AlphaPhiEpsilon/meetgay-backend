// ui.js - Gestion de l'interface utilisateur (messages, bio, enveloppe)

let currentReceivedMessage = null;
let currentReceivedFrom = null;

function displayMessage(text, type, fromPseudo = null, targetName = null) {
    const messageArea = document.getElementById('messageArea');
    if (!messageArea) return;

    messageArea.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'current-message';

    if (type === 'received') {
        div.innerHTML = `<strong>✉️ ${escapeHtml(fromPseudo)} :</strong> ${escapeHtml(text)}`;
        div.style.background = '#fff0e0';
        div.style.padding = '15px';
        div.style.borderRadius = '12px';
        currentReceivedMessage = text;
        currentReceivedFrom = fromPseudo;
    } else if (type === 'sent') {
        div.innerHTML = `<strong>📤 Vous → ${escapeHtml(targetName)} :</strong> ${escapeHtml(text)}`;
        div.style.background = '#e0f0ff';
        div.style.padding = '15px';
        div.style.borderRadius = '12px';
        currentReceivedMessage = null;
        currentReceivedFrom = null;
    }

    messageArea.appendChild(div);
}

function clearMessageArea() {
    const messageArea = document.getElementById('messageArea');
    const t = window.chatT || { emptyMessage: "💬 En attente de message..." };
    if (messageArea) {
        messageArea.innerHTML = `<div class="empty-message">${t.emptyMessage}</div>`;
    }
    currentReceivedMessage = null;
    currentReceivedFrom = null;
}

function showContactInfo(pseudo, age, gender, orientation, location, purpose, bio) {
    const contactInfoDiv = document.getElementById('contactInfo');
    const contactNameSpan = document.getElementById('contactName');
    const contactAgeSpan = document.getElementById('contactAge');
    const contactGenderSpan = document.getElementById('contactGender');
    const contactOrientationSpan = document.getElementById('contactOrientation');
    const contactPurposeDiv = document.getElementById('contactPurpose');
    const contactBioSpan = document.getElementById('contactBio');

    if (!contactInfoDiv) return;

    contactInfoDiv.style.display = 'block';

    // 1. Pseudo
    if (contactNameSpan) contactNameSpan.innerText = pseudo || '?';

    // 2. Âge
    if (contactAgeSpan) contactAgeSpan.innerText = age || '?';

    // 3. Genre
    let genderText = '?';
    if (gender === 'G') genderText = 'Gay';
    else if (gender === 'H') genderText = (window.chatLang === 'fr' ? 'Hétéro' : 'Hetero');
    else if (gender === 'T') genderText = (window.chatLang === 'fr' ? 'Transgenre' : 'Transgender');
    if (contactGenderSpan) contactGenderSpan.innerText = genderText;

    // 4. Orientation
    const orientationText = getOrientationText(orientation) || '?';
    if (contactOrientationSpan) contactOrientationSpan.innerText = orientationText;

    // 5. Localité (on l'ajoute à la suite de l'orientation)
    const locationText = (location && location !== 'undefined') ? location : '';
    if (locationText && contactOrientationSpan) {
        // On ajoute la localité après l'orientation
        contactOrientationSpan.innerText = `${orientationText} | ${locationText}`;
    }

    // 6. Objectif
    let purposeText = '';
    if (purpose === 'meeting') purposeText = (window.chatLang === 'fr' ? '💬 Rencontre' : '💬 Ontmoeting');
    else if (purpose === 'flirt') purposeText = (window.chatLang === 'fr' ? '😘 Flirt' : '😘 Flirt');
    else if (purpose === 'adultery') purposeText = (window.chatLang === 'fr' ? '💔 Relation sexuelle' : '💔 Seksuele relatie');
    else purposeText = (window.chatLang === 'fr' ? 'Non précisé' : 'Niet gespecificeerd');

    if (contactPurposeDiv) {
        contactPurposeDiv.innerHTML = `🎯 Je suis ici pour : ${purposeText}`;
    }

    // 7. Bio
    if (contactBioSpan) {
        contactBioSpan.innerText = bio || (window.chatLang === 'fr' ? 'Pas de présentation' : 'Geen introductie');
    }
}


function hideContactInfo() {
    const contactInfoDiv = document.getElementById('contactInfo');
    if (contactInfoDiv) contactInfoDiv.style.display = 'none';
}

function updateEnvelope(pendingCount) {
    const envelope = document.getElementById('envelope');
    if (!envelope) return;

    if (pendingCount > 0) {
        envelope.style.display = 'flex';
        const oldBadge = envelope.querySelector('.pending-badge');
        if (oldBadge) oldBadge.remove();
        const badge = document.createElement('span');
        badge.className = 'pending-badge';
        badge.textContent = pendingCount;
        envelope.appendChild(badge);
    } else {
        envelope.style.display = 'none';
    }
}

function startBlinking() {
    const envelope = document.getElementById('envelope');
    if (envelope) envelope.classList.add('blinking');
}

function stopBlinking() {
    const envelope = document.getElementById('envelope');
    if (envelope) envelope.classList.remove('blinking');
}