const EDUCATION_LEVELS = [
    {
        id: 'SD',
        order: 0,
        name: 'Sekolah Dasar (SD)',
        emoji: '📘',
        prerequisite: null,
        sessionsRequired: 0,
        costPerSession: 0
    },
    {
        id: 'SMP',
        order: 1,
        name: 'Sekolah Menengah Pertama (SMP)',
        emoji: '📗',
        prerequisite: 'SD',
        sessionsRequired: 6,
        costPerSession: 10000
    },
    {
        id: 'SMA',
        order: 2,
        name: 'Sekolah Menengah Atas (SMA)',
        emoji: '📙',
        prerequisite: 'SMP',
        sessionsRequired: 10,
        costPerSession: 20000
    },
    {
        id: 'D3',
        order: 3,
        name: 'Diploma 3 (D3)',
        emoji: '🎓',
        prerequisite: 'SMA',
        sessionsRequired: 15,
        costPerSession: 35000
    },
    {
        id: 'S1',
        order: 4,
        name: 'Sarjana (S1)',
        emoji: '🎓',
        prerequisite: 'SMA',
        sessionsRequired: 25,
        costPerSession: 50000
    },
    {
        id: 'S2',
        order: 5,
        name: 'Magister (S2)',
        emoji: '🏛️',
        prerequisite: 'S1',
        sessionsRequired: 35,
        costPerSession: 120000
    }
];

function getEducation(id) {
    return EDUCATION_LEVELS.find(e => e.id.toUpperCase() === String(id || 'SD').toUpperCase()) || EDUCATION_LEVELS[0];
}

function meetsEducationRequirement(playerEduId, requiredEduId) {
    if (!requiredEduId) return true;
    const playerEdu = getEducation(playerEduId);
    const reqEdu = getEducation(requiredEduId);
    return playerEdu.order >= reqEdu.order;
}

function getAvailableNextEducations(currentEduId) {
    const current = getEducation(currentEduId);
    return EDUCATION_LEVELS.filter(e => {
        if (e.order <= current.order) return false;
        if (e.prerequisite === current.id) return true;
        // Jika sudah D3 dan ingin lanjut S1
        if (current.id === 'D3' && e.id === 'S1') return true;
        return false;
    });
}

module.exports = {
    EDUCATION_LEVELS,
    getEducation,
    meetsEducationRequirement,
    getAvailableNextEducations
};
