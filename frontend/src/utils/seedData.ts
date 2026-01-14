import { collection, addDoc, query, where, getDocs, deleteDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';

export interface SampleMemory {
    text: string;
    tags: string[];
    category: string;
    nodes: Array<{ id: string; name: string; val: number }>;
    links: Array<{ source: string; target: string }>;
}

export const sampleMemories: SampleMemory[] = [
    {
        text: "Hoje aprendi sobre React Hooks. O useState permite gerenciar estado em componentes funcionais, enquanto o useEffect lida com efeitos colaterais. É uma revolução na forma de escrever componentes!",
        tags: ["programação", "react", "aprendizado"],
        category: "Tecnologia",
        nodes: [
            { id: '1', name: 'React', val: 10 },
            { id: '2', name: 'Hooks', val: 8 },
            { id: '3', name: 'useState', val: 6 },
            { id: '4', name: 'useEffect', val: 6 }
        ],
        links: [
            { source: '1', target: '2' },
            { source: '2', target: '3' },
            { source: '2', target: '4' }
        ]
    },
    {
        text: "Meditação matinal de 20 minutos. Focado na respiração e observação dos pensamentos sem julgamento. Senti uma clareza mental incrível depois.",
        tags: ["meditação", "bem-estar", "mindfulness"],
        category: "Saúde",
        nodes: [
            { id: '5', name: 'Meditação', val: 9 },
            { id: '6', name: 'Respiração', val: 7 },
            { id: '7', name: 'Mindfulness', val: 8 },
            { id: '8', name: 'Clareza Mental', val: 6 }
        ],
        links: [
            { source: '5', target: '6' },
            { source: '5', target: '7' },
            { source: '7', target: '8' }
        ]
    },
    {
        text: "Reunião com a equipe sobre o novo projeto. Decidimos usar arquitetura serverless com Firebase. Vantagens: escalabilidade automática, custo reduzido, deploy rápido.",
        tags: ["trabalho", "firebase", "arquitetura"],
        category: "Trabalho",
        nodes: [
            { id: '9', name: 'Projeto', val: 10 },
            { id: '10', name: 'Serverless', val: 8 },
            { id: '11', name: 'Firebase', val: 9 },
            { id: '12', name: 'Escalabilidade', val: 7 }
        ],
        links: [
            { source: '9', target: '10' },
            { source: '10', target: '11' },
            { source: '11', target: '12' }
        ]
    },
    {
        text: "Leitura do livro 'Atomic Habits'. Insight principal: pequenas mudanças compostas ao longo do tempo geram resultados extraordinários. 1% melhor a cada dia = 37x melhor em um ano!",
        tags: ["leitura", "hábitos", "produtividade"],
        category: "Desenvolvimento Pessoal",
        nodes: [
            { id: '13', name: 'Atomic Habits', val: 10 },
            { id: '14', name: 'Hábitos', val: 9 },
            { id: '15', name: 'Melhoria Contínua', val: 8 },
            { id: '16', name: 'Composição', val: 7 }
        ],
        links: [
            { source: '13', target: '14' },
            { source: '14', target: '15' },
            { source: '15', target: '16' }
        ]
    },
    {
        text: "Caminhada no parque ao pôr do sol. Observei como a luz dourada transformava tudo. Momento de gratidão pela beleza simples da natureza.",
        tags: ["natureza", "gratidão", "contemplação"],
        category: "Lazer",
        nodes: [
            { id: '17', name: 'Natureza', val: 9 },
            { id: '18', name: 'Pôr do Sol', val: 8 },
            { id: '19', name: 'Gratidão', val: 7 },
            { id: '20', name: 'Beleza', val: 6 }
        ],
        links: [
            { source: '17', target: '18' },
            { source: '18', target: '19' },
            { source: '19', target: '20' }
        ]
    },
    {
        text: "Experimentei uma nova receita de risoto de cogumelos. O segredo está no caldo quente adicionado aos poucos e na paciência para mexer constantemente. Ficou cremoso e delicioso!",
        tags: ["culinária", "receita", "italiano"],
        category: "Gastronomia",
        nodes: [
            { id: '21', name: 'Risoto', val: 8 },
            { id: '22', name: 'Cogumelos', val: 7 },
            { id: '23', name: 'Técnica', val: 6 },
            { id: '24', name: 'Paciência', val: 5 }
        ],
        links: [
            { source: '21', target: '22' },
            { source: '21', target: '23' },
            { source: '23', target: '24' }
        ]
    },
    {
        text: "Sessão de brainstorming para o design do novo app. Exploramos conceitos de glassmorphism e dark mode. A equipe adorou a ideia de usar gradientes sutis e animações suaves.",
        tags: ["design", "ui/ux", "criatividade"],
        category: "Design",
        nodes: [
            { id: '25', name: 'Design', val: 10 },
            { id: '26', name: 'Glassmorphism', val: 8 },
            { id: '27', name: 'Dark Mode', val: 7 },
            { id: '28', name: 'Animações', val: 6 }
        ],
        links: [
            { source: '25', target: '26' },
            { source: '25', target: '27' },
            { source: '25', target: '28' }
        ]
    },
    {
        text: "Conversa profunda com um amigo sobre propósito de vida. Percebemos que a felicidade vem mais da jornada do que do destino. Cada momento presente é uma oportunidade de crescimento.",
        tags: ["filosofia", "amizade", "reflexão"],
        category: "Relacionamentos",
        nodes: [
            { id: '29', name: 'Propósito', val: 9 },
            { id: '30', name: 'Felicidade', val: 8 },
            { id: '31', name: 'Jornada', val: 7 },
            { id: '32', name: 'Presente', val: 6 }
        ],
        links: [
            { source: '29', target: '30' },
            { source: '30', target: '31' },
            { source: '31', target: '32' }
        ]
    },
    {
        text: "Aprendi sobre TypeScript generics hoje. Permitem criar componentes reutilizáveis que funcionam com vários tipos mantendo type safety. Exemplo: Array<T>, Promise<T>.",
        tags: ["typescript", "programação", "generics"],
        category: "Tecnologia",
        nodes: [
            { id: '33', name: 'TypeScript', val: 10 },
            { id: '34', name: 'Generics', val: 9 },
            { id: '35', name: 'Type Safety', val: 8 },
            { id: '36', name: 'Reutilização', val: 7 }
        ],
        links: [
            { source: '33', target: '34' },
            { source: '34', target: '35' },
            { source: '34', target: '36' }
        ]
    },
    {
        text: "Yoga session focada em alongamento e flexibilidade. Consegui finalmente fazer a postura do pombo completa! A prática constante realmente traz resultados.",
        tags: ["yoga", "flexibilidade", "conquista"],
        category: "Saúde",
        nodes: [
            { id: '37', name: 'Yoga', val: 9 },
            { id: '38', name: 'Flexibilidade', val: 8 },
            { id: '39', name: 'Prática', val: 7 },
            { id: '40', name: 'Progresso', val: 6 }
        ],
        links: [
            { source: '37', target: '38' },
            { source: '38', target: '39' },
            { source: '39', target: '40' }
        ]
    }
];

export async function seedDatabase(): Promise<{ success: boolean; count: number; error?: string }> {
    try {
        if (!auth.currentUser) {
            return { success: false, count: 0, error: 'Usuário não autenticado' };
        }

        let count = 0;
        for (const memory of sampleMemories) {
            await addDoc(collection(db, 'sessions'), {
                text: memory.text,
                tags: memory.tags,
                category: memory.category,
                nodes: memory.nodes,
                links: memory.links,
                timestamp: Date.now() - (count * 3600000), // Espaçar por 1 hora cada
                updatedAt: Date.now(),
                uid: auth.currentUser.uid,
                isTestData: true // Flag to identify test data
            });
            count++;
        }

        return { success: true, count };
    } catch (error: any) {
        console.error('Erro ao popular banco:', error);
        return { success: false, count: 0, error: error.message };
    }
}

/**
 * Remove all test data from the database
 */
export async function removeTestData(): Promise<{ success: boolean; count?: number; error?: string }> {
    try {
        if (!auth.currentUser) {
            return { success: false, error: 'User not authenticated' };
        }

        const sessionsRef = collection(db, 'sessions');
        const q = query(
            sessionsRef,
            where('uid', '==', auth.currentUser.uid),
            where('isTestData', '==', true)
        );

        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return { success: true, count: 0 };
        }

        // Delete all test data documents
        const deletePromises = snapshot.docs.map((doc: any) => deleteDoc(doc.ref));
        await Promise.all(deletePromises);

        console.log(`✅ Removed ${snapshot.docs.length} test memories`);
        return { success: true, count: snapshot.docs.length };
    } catch (error) {
        console.error('Error removing test data:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}
