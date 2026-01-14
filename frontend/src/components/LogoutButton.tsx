import React from 'react';
import { LogOut } from 'lucide-react';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';

export const LogoutButton: React.FC = () => {
    const handleLogout = async () => {
        if (!confirm('Tem certeza que deseja sair?')) return;

        try {
            // Clear local data
            localStorage.clear();
            sessionStorage.clear();

            // Sign out from Firebase
            await signOut(auth);

            // Redirect to home
            window.location.href = '/';
        } catch (error: any) {
            console.error('Erro ao fazer logout:', error);
            alert(`❌ Erro ao fazer logout: ${error.message}`);
        }
    };

    return (
        <button
            onClick={handleLogout}
            className="glass-button !p-2 hover:bg-red-500/10 hover:border-red-500/20 transition-all group"
            title="Sair"
        >
            <LogOut className="w-5 h-5 text-gray-400 group-hover:text-red-400 transition-colors" />
        </button>
    );
};
