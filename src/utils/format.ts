export function formatDisplayName(name: string | undefined, phone: string) {
    if (!name || name === phone) {
        return phone.split('@')[0];
    }
    // If name is just a JID, clean it up
    if (name.includes('@')) {
        return name.split('@')[0];
    }
    return name;
}
