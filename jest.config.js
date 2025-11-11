export default {
    preset: 'ts-jest/presets/default-esm',
    testEnvironment: 'node',
    extensionsToTreatAsEsm: ['.ts'],
    transform: {
        '^.+\\.tsx?$': [
            'ts-jest',
            {
                useESM: true,
            },
        ],
        '^.+\\.jsx?$': [
            'ts-jest',
            {
                useESM: true,
            },
        ],
    },
    transformIgnorePatterns: [
        'node_modules/(?!js-aborts)'
    ],
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
    },
};