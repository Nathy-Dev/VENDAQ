import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const NEXT_JS_URL = process.env.NEXT_JS_URL || 'http://localhost:3000/api/worker';
const TEST_BUSINESS_ID = "j5717mbhfsftwhcvk6frt4stnx833r8a" as any; // Discovered business ID

async function testSync() {
    console.log("Starting test sync...");
    
    const mockHistory = [
        {
            sender: "2348123456789",
            content: "Hello from the past!",
            timestamp: Date.now() - 1000 * 60 * 60,
            fromMe: false,
            name: "Nate Dev"
        },
        {
            sender: "2349876543210",
            content: "Is this MERXAGE?",
            timestamp: Date.now() - 1000 * 60 * 30,
            fromMe: false,
            name: "Prospective Customer"
        }
    ];

    try {
        const response = await fetch(NEXT_JS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'syncHistory',
                businessId: TEST_BUSINESS_ID,
                history: mockHistory
            })
        });

        const result = await response.json() as any;
        console.log("Sync Result:", result);
        
        if (response.ok) {
            console.log("Test PASSED: Historical sync successful.");
        } else {
            console.error("Test FAILED:", result.error);
        }
    } catch (error: any) {
        console.error("Test ERROR:", error.message);
    }
}

testSync();
