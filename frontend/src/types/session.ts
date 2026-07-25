export interface Session {
    id: string;
    text: string;
    timestamp: number;
    updatedAt: number;
    uid: string;
    tags?: string[];
    category?: string;
    entities?: {
        people?: string[];
        places?: string[];
        events?: string[];
        concepts?: string[];
    };
}

export interface FirebaseError {
    code?: string;
    message?: string;
}
