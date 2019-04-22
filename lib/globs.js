'use strict';
const path = require('path');
const arrFlatten = require('arr-flatten');
const globby = require('globby');
const ignoreByDefault = require('ignore-by-default');
const micromatch = require('micromatch');
const slash = require('slash');

const defaultIgnorePatterns = [...ignoreByDefault.directories(), '**/node_modules'];

const buildExtensionPattern = extensions => extensions.length === 1 ? extensions[0] : `{${extensions.join(',')}}`;

const normalizePatterns = patterns => {
	// Always use `/` in patterns, harmonizing matching across platforms
	if (process.platform === 'win32') {
		patterns = patterns.map(pattern => slash(pattern));
	}

	return patterns.map(pattern => {
		if (pattern.startsWith('./')) {
			return pattern.slice(2);
		}

		if (pattern.startsWith('!./')) {
			return `!${pattern.slice(3)}`;
		}

		return pattern;
	});
};

function normalizeGlobs(testPatterns, sourcePatterns, extensions) {
	if (typeof testPatterns !== 'undefined' && (!Array.isArray(testPatterns) || testPatterns.length === 0)) {
		throw new Error('The \'files\' configuration must be an array containing glob patterns.');
	}

	if (sourcePatterns && (!Array.isArray(sourcePatterns) || sourcePatterns.length === 0)) {
		throw new Error('The \'sources\' configuration must be an array containing glob patterns.');
	}

	const extensionPattern = buildExtensionPattern(extensions);
	const defaultTestPatterns = [
		`**/__tests__/**/*.${extensionPattern}`,
		`**/*.test.${extensionPattern}`,
		`**/test-*.${extensionPattern}`,
		`**/test.${extensionPattern}`,
		`**/test/**/*.${extensionPattern}`
	];

	if (testPatterns) {
		testPatterns = normalizePatterns(testPatterns);

		if (testPatterns.every(pattern => pattern.startsWith('!'))) {
			// Use defaults if patterns only contains exclusions.
			testPatterns = [...defaultTestPatterns, ...testPatterns];
		}
	} else {
		testPatterns = defaultTestPatterns;
	}

	const defaultSourcePatterns = [
		'**/*.snap',
		'ava.config.js',
		'package.json',
		`**/*.${extensionPattern}`
	];
	if (sourcePatterns) {
		sourcePatterns = normalizePatterns(sourcePatterns);

		if (sourcePatterns.every(pattern => pattern.startsWith('!'))) {
			// Use defaults if patterns only contains exclusions.
			sourcePatterns = [...defaultSourcePatterns, ...sourcePatterns];
		}
	} else {
		sourcePatterns = defaultSourcePatterns;
	}

	return {extensions, testPatterns, sourcePatterns};
}

exports.normalizeGlobs = normalizeGlobs;

const findFiles = async (cwd, patterns) => {
	const files = await globby(patterns, {
		absolute: true,
		brace: true,
		case: false,
		cwd,
		dot: false,
		expandDirectories: false,
		extglob: true,
		followSymlinkedDirectories: true,
		gitignore: false,
		globstar: true,
		ignore: defaultIgnorePatterns,
		matchBase: false,
		onlyFiles: true,
		stats: false,
		unique: true
	});

	// `globby` returns slashes even on Windows. Normalize here so the file
	// paths are consistently platform-accurate as tests are run.
	if (process.platform === 'win32') {
		return files.map(file => path.normalize(file));
	}

	return files;
};

async function findHelpersAndTests({cwd, extensions, testPatterns}) {
	const helpers = [];
	const tests = [];
	for (const file of await findFiles(cwd, testPatterns)) {
		if (!extensions.includes(path.extname(file).slice(1))) {
			continue;
		}

		if (path.basename(file).startsWith('_')) {
			helpers.push(file);
		} else {
			tests.push(file);
		}
	}

	return {helpers, tests};
}

exports.findHelpersAndTests = findHelpersAndTests;

function getChokidarPatterns({sourcePatterns, testPatterns}) {
	const paths = [];
	const ignored = defaultIgnorePatterns.map(pattern => `${pattern}/**/*`);

	for (const pattern of [...sourcePatterns, ...testPatterns]) {
		if (pattern.startsWith('!')) {
			ignored.push(pattern.slice(1));
		} else {
			paths.push(pattern);
		}
	}

	return {paths, ignored};
}

exports.getChokidarPatterns = getChokidarPatterns;

const matches = (file, patterns) => {
	const ignore = [...defaultIgnorePatterns];
	patterns = patterns.filter(pattern => {
		if (pattern.startsWith('!')) {
			ignore.push(pattern.slice(1));
			return false;
		}

		return true;
	});

	return micromatch.some(file, patterns, {
		// Unlike globby(), micromatch needs a complete pattern when ignoring directories.
		ignore: arrFlatten(ignore.map(pattern => [pattern, `${pattern}/**/*`]))
	});
};

function isSource(file, {testPatterns, sourcePatterns}) {
	return !isTest(file, {testPatterns}) && matches(file, sourcePatterns);
}

exports.isSource = isSource;

function isTest(file, {testPatterns}) {
	return !path.basename(file).startsWith('_') && matches(file, testPatterns);
}

exports.isTest = isTest;
