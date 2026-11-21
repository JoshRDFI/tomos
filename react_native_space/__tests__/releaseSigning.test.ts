import * as fs from 'fs';
import * as path from 'path';
const { addReleaseSigning, PROPS } = require('../plugins/withReleaseSigning');

// The app/build.gradle that `expo prebuild` generates (Expo SDK 54).
const generated = fs.readFileSync(path.join(__dirname, 'fixtures/app.build.gradle'), 'utf8');

function releaseBuildType(gradle: string): string {
  const types = gradle.slice(gradle.indexOf('buildTypes {'));
  return types.slice(types.indexOf('release {'), types.indexOf('packagingOptions'));
}

describe('release signing plugin', () => {
  it('signs release builds with the key named in gradle properties, if any', () => {
    const out = addReleaseSigning(generated);
    expect(releaseBuildType(out)).toContain(`signingConfig findProperty('${PROPS.storeFile}') ? signingConfigs.release : signingConfigs.debug`);
    expect(releaseBuildType(out)).not.toMatch(/signingConfig signingConfigs\.debug\n/);
    for (const p of Object.values(PROPS)) expect(out).toContain(`findProperty('${p}')`);
  });

  it('leaves debug builds on the debug key', () => {
    const out = addReleaseSigning(generated);
    const debugType = out.slice(out.indexOf('buildTypes {')).split('release {')[0];
    expect(debugType).toContain('signingConfig signingConfigs.debug');
  });

  it('applying it twice changes nothing more', () => {
    const once = addReleaseSigning(generated);
    expect(addReleaseSigning(once)).toBe(once);
  });

  it('fails loudly if the generated file no longer looks as expected', () => {
    expect(() => addReleaseSigning('android {}')).toThrow(/release signing/);
  });

  it('adds no secrets to the file: everything comes from gradle properties', () => {
    const before = new Set(generated.split('\n'));
    const added = addReleaseSigning(generated).split('\n').filter((l: string) => !before.has(l));
    expect(added.length).toBeGreaterThan(0);
    for (const line of added) expect(line).not.toMatch(/\.jks|['"][^'"]*['"]\s*$/);
  });
});
