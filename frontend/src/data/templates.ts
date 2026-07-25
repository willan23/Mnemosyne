import type { Template } from '../types/templates';

/**
 * Templates pré-definidos para o Mnemosyne
 * Cada template fornece uma estrutura específica para diferentes tipos de memórias
 */

export const templates: Template[] = [
    {
        id: 'daily-journal',
        name: 'Diário Diário',
        description: 'Reflexão diária estruturada com gratidão e aprendizados',
        icon: '📝',
        category: 'personal',
        blocks: [
            { type: 'heading', content: '📅 {{date}}' },
            { type: 'divider' },
            {
                type: 'prompt',
                content: '🌅 Como estou me sentindo hoje?',
                placeholder: 'Descreva seu estado emocional e energia...',
                required: true
            },
            {
                type: 'prompt',
                content: '🎯 Qual é minha principal prioridade hoje?',
                placeholder: 'Uma coisa que preciso fazer hoje...'
            },
            { type: 'divider' },
            { type: 'heading', content: '🙏 Gratidão' },
            {
                type: 'text',
                placeholder: '1. ',
                content: 'Três coisas pelas quais sou grato:'
            },
            { type: 'text', placeholder: '2. ' },
            { type: 'text', placeholder: '3. ' },
            { type: 'divider' },
            { type: 'heading', content: '📚 Aprendizados' },
            {
                type: 'prompt',
                content: 'O que aprendi hoje?',
                placeholder: 'Insights, descobertas, lições...'
            },
            { type: 'divider' },
            { type: 'heading', content: '💭 Reflexão' },
            {
                type: 'prompt',
                content: 'O que poderia ter feito melhor?',
                placeholder: 'Áreas de melhoria e próximos passos...'
            }
        ],
        defaultTags: ['diário', 'reflexão', 'desenvolvimento-pessoal'],
        defaultCategory: 'Desenvolvimento Pessoal'
    },

    {
        id: 'book-notes',
        name: 'Anotações de Livro',
        description: 'Método Cornell Notes adaptado para capturar insights de leitura',
        icon: '📚',
        category: 'learning',
        blocks: [
            { type: 'heading', content: '📖 {{title}}' },
            {
                type: 'text',
                placeholder: 'Nome do autor',
                content: '✍️ Autor:',
                required: true
            },
            {
                type: 'text',
                placeholder: 'Ex: Desenvolvimento Pessoal, Ficção, Negócios...',
                content: '📂 Gênero:'
            },
            { type: 'divider' },
            { type: 'heading', content: '🎯 Principais Ideias' },
            {
                type: 'prompt',
                placeholder: 'Conceitos centrais, teses principais, argumentos chave...',
                required: true
            },
            { type: 'divider' },
            { type: 'heading', content: '📝 Notas e Citações' },
            {
                type: 'prompt',
                placeholder: 'Anotações detalhadas, citações importantes, passagens marcantes...'
            },
            { type: 'divider' },
            { type: 'heading', content: '💡 Insights Pessoais' },
            {
                type: 'prompt',
                placeholder: 'Como isso se aplica à minha vida? O que vou fazer diferente?'
            },
            { type: 'divider' },
            { type: 'heading', content: '✅ Action Items' },
            {
                type: 'text',
                content: 'Ações concretas baseadas no livro:',
                placeholder: '☐ '
            },
            { type: 'text', placeholder: '☐ ' },
            { type: 'text', placeholder: '☐ ' },
            { type: 'divider' },
            { type: 'heading', content: '⭐ Avaliação' },
            {
                type: 'text',
                content: 'Nota (1-5):',
                placeholder: '⭐⭐⭐⭐⭐'
            }
        ],
        defaultTags: ['livro', 'leitura', 'aprendizado'],
        defaultCategory: 'Leitura'
    },

    {
        id: 'meeting-notes',
        name: 'Notas de Reunião',
        description: 'Estrutura profissional para reuniões produtivas',
        icon: '💼',
        category: 'work',
        blocks: [
            { type: 'heading', content: '🤝 Reunião: {{title}}' },
            { type: 'text', content: '📅 Data: {{date}}' },
            {
                type: 'text',
                placeholder: 'Nome dos participantes',
                content: '👥 Participantes:'
            },
            { type: 'divider' },
            { type: 'heading', content: '🎯 Objetivo' },
            {
                type: 'prompt',
                placeholder: 'Propósito e metas desta reunião...',
                required: true
            },
            { type: 'divider' },
            { type: 'heading', content: '📋 Agenda' },
            { type: 'text', content: 'Tópicos a discutir:', placeholder: '1. ' },
            { type: 'text', placeholder: '2. ' },
            { type: 'text', placeholder: '3. ' },
            { type: 'divider' },
            { type: 'heading', content: '💬 Discussão' },
            {
                type: 'prompt',
                placeholder: 'Pontos principais discutidos, ideias levantadas, debates...'
            },
            { type: 'divider' },
            { type: 'heading', content: '✅ Decisões' },
            {
                type: 'prompt',
                placeholder: 'O que foi decidido? Acordos alcançados...'
            },
            { type: 'divider' },
            { type: 'heading', content: '🎯 Action Items' },
            {
                type: 'text',
                content: 'Tarefas e responsáveis:',
                placeholder: '☐ [Quem] - [O quê] - [Quando]'
            },
            { type: 'text', placeholder: '☐ [Quem] - [O quê] - [Quando]' },
            { type: 'text', placeholder: '☐ [Quem] - [O quê] - [Quando]' },
            { type: 'divider' },
            { type: 'heading', content: '📅 Próximos Passos' },
            {
                type: 'prompt',
                placeholder: 'Próxima reunião, follow-ups necessários...'
            }
        ],
        defaultTags: ['reunião', 'trabalho', 'produtividade'],
        defaultCategory: 'Trabalho'
    },

    {
        id: 'idea-capture',
        name: 'Captura de Ideia',
        description: 'Capture e desenvolva ideias rapidamente',
        icon: '💡',
        category: 'creative',
        blocks: [
            { type: 'heading', content: '💡 {{title}}' },
            { type: 'divider' },
            { type: 'heading', content: '🌟 A Ideia' },
            {
                type: 'prompt',
                placeholder: 'Descreva sua ideia em poucas palavras...',
                required: true
            },
            { type: 'divider' },
            { type: 'heading', content: '🤔 Por que isso importa?' },
            {
                type: 'prompt',
                placeholder: 'Qual problema isso resolve? Que valor cria?'
            },
            { type: 'divider' },
            { type: 'heading', content: '🎨 Como funciona?' },
            {
                type: 'prompt',
                placeholder: 'Explique o conceito, mecânica, implementação...'
            },
            { type: 'divider' },
            { type: 'heading', content: '🚀 Próximos Passos' },
            {
                type: 'text',
                content: 'Ações para desenvolver esta ideia:',
                placeholder: '☐ '
            },
            { type: 'text', placeholder: '☐ ' },
            { type: 'text', placeholder: '☐ ' },
            { type: 'divider' },
            { type: 'heading', content: '🔗 Conexões' },
            {
                type: 'prompt',
                placeholder: 'Ideias relacionadas, inspirações, referências...'
            }
        ],
        defaultTags: ['ideia', 'criatividade', 'inovação'],
        defaultCategory: 'Ideias'
    },

    {
        id: 'learning-session',
        name: 'Sessão de Estudo',
        description: 'Estrutura para aprendizado efetivo e retenção',
        icon: '🎓',
        category: 'learning',
        blocks: [
            { type: 'heading', content: '🎓 {{title}}' },
            {
                type: 'text',
                content: '📚 Assunto:',
                placeholder: 'Tópico ou matéria estudada'
            },
            {
                type: 'text',
                content: '⏱️ Duração:',
                placeholder: 'Tempo dedicado ao estudo'
            },
            { type: 'divider' },
            { type: 'heading', content: '🎯 Objetivos' },
            {
                type: 'prompt',
                placeholder: 'O que quero aprender nesta sessão?',
                required: true
            },
            { type: 'divider' },
            { type: 'heading', content: '📝 Notas Principais' },
            {
                type: 'prompt',
                placeholder: 'Conceitos chave, fórmulas, definições...'
            },
            { type: 'divider' },
            { type: 'heading', content: '❓ Dúvidas' },
            {
                type: 'prompt',
                placeholder: 'O que ainda não entendi? Preciso pesquisar mais sobre...'
            },
            { type: 'divider' },
            { type: 'heading', content: '💡 Insights' },
            {
                type: 'prompt',
                placeholder: 'Conexões com outros conhecimentos, aplicações práticas...'
            },
            { type: 'divider' },
            { type: 'heading', content: '✅ Revisão' },
            {
                type: 'text',
                content: 'Revisar em:',
                placeholder: '☐ 1 dia | ☐ 1 semana | ☐ 1 mês'
            }
        ],
        defaultTags: ['estudo', 'aprendizado', 'educação'],
        defaultCategory: 'Estudos'
    },

    {
        id: 'project-planning',
        name: 'Planejamento de Projeto',
        description: 'Organize e planeje projetos de forma estruturada',
        icon: '🎯',
        category: 'productivity',
        blocks: [
            { type: 'heading', content: '🎯 Projeto: {{title}}' },
            { type: 'text', content: '📅 Data de Início: {{date}}' },
            {
                type: 'text',
                content: '🏁 Prazo:',
                placeholder: 'Data limite para conclusão'
            },
            { type: 'divider' },
            { type: 'heading', content: '🎯 Objetivo' },
            {
                type: 'prompt',
                placeholder: 'O que queremos alcançar com este projeto?',
                required: true
            },
            { type: 'divider' },
            { type: 'heading', content: '📋 Escopo' },
            {
                type: 'prompt',
                placeholder: 'O que está incluído? O que NÃO está incluído?'
            },
            { type: 'divider' },
            { type: 'heading', content: '📊 Fases do Projeto' },
            { type: 'text', placeholder: '1. Fase - Descrição' },
            { type: 'text', placeholder: '2. Fase - Descrição' },
            { type: 'text', placeholder: '3. Fase - Descrição' },
            { type: 'divider' },
            { type: 'heading', content: '👥 Equipe e Recursos' },
            {
                type: 'prompt',
                placeholder: 'Quem está envolvido? Que recursos precisamos?'
            },
            { type: 'divider' },
            { type: 'heading', content: '⚠️ Riscos' },
            {
                type: 'prompt',
                placeholder: 'Possíveis obstáculos e como mitigá-los...'
            },
            { type: 'divider' },
            { type: 'heading', content: '✅ Próximas Ações' },
            { type: 'text', placeholder: '☐ Ação imediata 1' },
            { type: 'text', placeholder: '☐ Ação imediata 2' },
            { type: 'text', placeholder: '☐ Ação imediata 3' }
        ],
        defaultTags: ['projeto', 'planejamento', 'produtividade'],
        defaultCategory: 'Projetos'
    }
];

/**
 * Obtém um template por ID
 */
export const getTemplateById = (id: string): Template | undefined => {
    return templates.find(t => t.id === id);
};

/**
 * Obtém templates por categoria
 */
export const getTemplatesByCategory = (category: string): Template[] => {
    if (category === 'all') return templates;
    return templates.filter(t => t.category === category);
};

/**
 * Processa um template substituindo variáveis
 */
export const processTemplate = (template: Template, variables: Record<string, string> = {}): string => {
    const defaultVars = {
        date: new Date().toLocaleDateString('pt-PT', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        }),
        title: 'Nova Memória',
        ...variables
    };

    let result = '';

    template.blocks.forEach(block => {
        switch (block.type) {
            case 'heading':
                result += `\n## ${replaceVariables(block.content || '', defaultVars)}\n`;
                break;
            case 'text':
                if (block.content) {
                    result += `\n${replaceVariables(block.content, defaultVars)} ${block.placeholder || ''}\n`;
                } else {
                    result += `\n${block.placeholder || ''}\n`;
                }
                break;
            case 'prompt':
                if (block.content) {
                    result += `\n**${replaceVariables(block.content, defaultVars)}**\n`;
                }
                result += `${block.placeholder || ''}\n`;
                break;
            case 'divider':
                result += `\n---\n`;
                break;
            default:
                break;
        }
    });

    return result.trim();
};

/**
 * Substitui variáveis no formato {{variavel}}
 */
const replaceVariables = (text: string, variables: Record<string, string>): string => {
    return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        return variables[key] || match;
    });
};
