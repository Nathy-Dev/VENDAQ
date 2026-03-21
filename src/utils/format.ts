/**
 * Returns a human-readable display name for a customer.
 * Priority: saved name > formatted phone number.
 */
export function formatDisplayName(name: string | undefined, phone: string): string {
    // If we have a real name that isn't just the phone/JID, use it
    if (name && name !== phone && !looksLikeRawId(name)) {
        // Clean up JID-style names
        if (name.includes('@')) {
            return name.split('@')[0];
        }
        return name;
    }

    // Fallback: format the phone number nicely
    return formatPhoneNumber(phone);
}

/** Check if a string looks like a raw JID or phone number rather than a real name */
function looksLikeRawId(value: string): boolean {
    // Pure digits (with optional leading +)
    const cleaned = value.replace(/[\s\-\(\)@s.whatsapp.net]/g, '');
    return /^\+?\d{7,}$/.test(cleaned);
}

/** Format a phone number or JID into a readable display string */
function formatPhoneNumber(phone: string): string {
    // Strip WhatsApp JID suffixes
    const cleaned = phone.split('@')[0];

    // If it doesn't start with +, add it for international format
    if (/^\d+$/.test(cleaned) && cleaned.length >= 10) {
        // Format as: +XXX XXX XXX XXXX (generic international)
        const withPlus = '+' + cleaned;
        // Group digits for readability: country code (1-3 digits) + groups of 3-4
        if (cleaned.length <= 11) {
            // e.g. 2348112345678 -> +234 811 234 5678
            return withPlus.replace(/(\+\d{1,3})(\d{3})(\d{3})(\d{4,})/, '$1 $2 $3 $4');
        }
        // For longer numbers, just add spaces every 3-4 digits
        return withPlus.replace(/(\+\d{1,3})(\d{3})(\d{3})(\d+)/, '$1 $2 $3 $4');
    }

    return cleaned || "Unknown";
}
