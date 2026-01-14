import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

// Firebase config (use your actual config)
const firebaseConfig = {
    apiKey: "AIzaSyDxTlrJlqTTBQFo1JjPHt5kC-mnDzROT3k",
    authDomain: "mnemosyne-one.firebaseapp.com",
    projectId: "mnemosyne-one",
    storageBucket: "mnemosyne-one.firebasestorage.app",
    messagingSenderId: "1051648396015",
    appId: "1:1051648396015:web:e5c2e6d5e5c2e6d5e5c2e6"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

async function migrateOldMemories() {
    console.log('🔄 Starting migration of old memories...');

    // Wait for authentication
    await new Promise((resolve) => {
        const unsubscribe = auth.onAuthStateChanged((user) => {
            if (user) {
                console.log(`✅ Authenticated as: ${user.uid}`);
                unsubscribe();
                resolve(user);
            }
        });
    });

    const currentUser = auth.currentUser;
    if (!currentUser) {
        console.error('❌ No user authenticated');
        return;
    }

    try {
        const sessionsRef = collection(db, 'sessions');
        const snapshot = await getDocs(sessionsRef);

        let updated = 0;
        let skipped = 0;
        let errors = 0;

        for (const docSnap of snapshot.docs) {
            const data = docSnap.data();

            // Check if memory needs migration
            if (!data.uid || data.uid === 'anon' || data.uid !== currentUser.uid) {
                try {
                    await updateDoc(doc(db, 'sessions', docSnap.id), {
                        uid: currentUser.uid,
                        migratedAt: Date.now()
                    });
                    updated++;
                    console.log(`✅ Updated: ${docSnap.id}`);
                } catch (error) {
                    errors++;
                    console.error(`❌ Error updating ${docSnap.id}:`, error);
                }
            } else {
                skipped++;
            }
        }

        console.log('\n📊 Migration Summary:');
        console.log(`✅ Updated: ${updated}`);
        console.log(`⏭️  Skipped: ${skipped}`);
        console.log(`❌ Errors: ${errors}`);
        console.log(`📝 Total: ${snapshot.docs.length}`);

    } catch (error) {
        console.error('❌ Migration failed:', error);
    }
}

// Run migration
migrateOldMemories();
