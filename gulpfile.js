const pkg = require('./package.json')
const path = require('path')
const glob = require('glob')
const yargs = require('yargs')
const colors = require('colors')
const qunit = require('node-qunit-puppeteer')

const {rollup} = require('rollup')
const {terser} = require('rollup-plugin-terser')
const babel = require('rollup-plugin-babel')
const commonjs = require('@rollup/plugin-commonjs')
const resolve = require('@rollup/plugin-node-resolve')

const gulp = require('gulp')
const tap = require('gulp-tap')
const zip = require('gulp-zip')
const sass = require('gulp-sass')
const header = require('gulp-header')
const eslint = require('gulp-eslint')
const minify = require('gulp-clean-css')
const connect = require('gulp-connect')
const autoprefixer = require('gulp-autoprefixer')

const root = yargs.argv.root || '.'
const port = yargs.argv.port || 8000

const banner = `/*!
* reveal.js ${pkg.version} (${new Date().toDateString()})
* ${pkg.homepage}
* MIT licensed
*
* Copyright (C) 2020 Hakim El Hattab, https://hakim.se
*/\n`

// Prevents warnings from opening too many test pages
process.setMaxListeners(20);

const rollupConfig = {
    plugins: [
        babel({
            exclude: 'node_modules/**',
            compact: false,
            presets: [[
                '@babel/preset-env',
                {
                    corejs: 3,
                    useBuiltIns: 'entry',
                    modules: false
                }
            ]]
        }),
        resolve(),
        commonjs(),
        terser()
    ]
};

gulp.task('js', () => {
    return rollup({
        input: 'js/index.js',
        ...rollupConfig
    }).then( bundle => {
        bundle.write({
            file: './dist/reveal.esm.js',
            format: 'es',
            banner: banner,
            sourcemap: true
        });

        bundle.write({
            name: 'Reveal',
            file: './dist/reveal.js',
            format: 'umd',
            banner: banner,
            sourcemap: true
        });
    });
})

gulp.task('plugins', () => {
    return Promise.all([
        { name: 'RevealHighlight', input: './plugin/highlight/plugin.js', output: './dist/plugin/highlight' },
        { name: 'RevealMarkdown', input: './plugin/markdown/plugin.js', output: './dist/plugin/markdown' },
        { name: 'RevealSearch', input: './plugin/search/plugin.js', output: './dist/plugin/search' },
        { name: 'RevealNotes', input: './plugin/notes/plugin.js', output: './dist/plugin/notes' },
        { name: 'RevealZoom', input: './plugin/zoom/plugin.js', output: './dist/plugin/zoom' },
        { name: 'RevealMath', input: './plugin/math/plugin.js', output: './dist/plugin/math' },
    ].map( plugin => {
        return rollup({
                input: plugin.input,
                ...rollupConfig
            }).then( bundle => {
                bundle.write({
                    file: plugin.output + '.esm.js',
                    name: plugin.name,
                    format: 'es'
                })

                bundle.write({
                    file: plugin.output + '.js',
                    name: plugin.name,
                    format: 'umd'
                })
            });
    } ));
})

gulp.task('css-themes', () => gulp.src(['./css/theme/source/*.{sass,scss}'])
        .pipe(sass())
        .pipe(gulp.dest('./dist/theme')))

gulp.task('css-core', () => gulp.src(['css/reveal.scss'])
    .pipe(sass())
    .pipe(autoprefixer())
    .pipe(minify({compatibility: 'ie9'}))
    .pipe(header(banner))
    .pipe(gulp.dest('./dist')))

gulp.task('css', gulp.parallel('css-themes', 'css-core'))

gulp.task('qunit', () => {

    let serverConfig = {
        root,
        port: 8009,
        host: '0.0.0.0',
        name: 'test-server'
    }

    let server = connect.server( serverConfig )

    let testFiles = glob.sync('test/*.html' )

    let totalTests = 0;
    let failingTests = 0;

    let tests = Promise.all( testFiles.map( filename => {
        return new Promise( ( resolve, reject ) => {
            qunit.runQunitPuppeteer({
                targetUrl: `http://${serverConfig.host}:${serverConfig.port}/${filename}`,
                timeout: 20000,
                redirectConsole: false,
                puppeteerArgs: ['--allow-file-access-from-files']
            })
                .then(result => {
                    if( result.stats.failed > 0 ) {
                        console.log(`${'!'} ${filename} [${result.stats.passed}/${result.stats.total}] in ${result.stats.runtime}ms`.red);
                        // qunit.printResultSummary(result, console);
                        qunit.printFailedTests(result, console);
                    }
                    else {
                        console.log(`${'✔'} ${filename} [${result.stats.passed}/${result.stats.total}] in ${result.stats.runtime}ms`.green);
                    }

                    totalTests += result.stats.total;
                    failingTests += result.stats.failed;

                    resolve();
                })
                .catch(error => {
                    console.error(error);
                    reject();
                });
        } )
    } ) );

    return new Promise( ( resolve, reject ) => {

        tests.then( () => {
                if( failingTests > 0 ) {
                    reject( new Error(`${failingTests}/${totalTests} tests failed`.red) );
                }
                else {
                    console.log(`${'✔'} Passed ${totalTests} tests`.green.bold);
                    resolve();
                }
            } )
            .catch( () => {
                reject();
            } )
            .finally( () => {
                server.close();
            } );

    } );
} )

gulp.task('eslint', () => gulp.src(['./js/**', 'gulpfile.js'])
        .pipe(eslint())
        .pipe(eslint.format()))

gulp.task('test', gulp.series( 'eslint', 'qunit' ))

gulp.task('default', gulp.series(gulp.parallel('js', 'css', 'plugins'), 'test'))

gulp.task('build', gulp.parallel('js', 'css', 'plugins'))

gulp.task('package', gulp.series('default', () =>

    gulp.src([
        './index.html',
        './dist/**',
        './lib/**',
        './images/**',
        './plugin/**',
        './**.md'
    ]).pipe(zip('reveal-js-presentation.zip')).pipe(gulp.dest('./'))

))

gulp.task('serve', () => {

    connect.server({
        root: root,
        port: port,
        host: '0.0.0.0',
        livereload: true
    })

    gulp.watch(['js/**'], gulp.series('js', 'test'))

    gulp.watch(['plugin/**/*.js'], gulp.series('plugins'))

    gulp.watch(['test/*.html'], gulp.series('test'))

    gulp.watch([
        'css/theme/source/*.{sass,scss}',
        'css/theme/template/*.{sass,scss}',
    ], gulp.series('css-themes'))

    gulp.watch([
        'css/reveal.scss',
        'css/print/*.{sass,scss,css}'
    ], gulp.series('css-core'))

})