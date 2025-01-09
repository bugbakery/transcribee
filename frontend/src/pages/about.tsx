import { AppCenter } from '../components/app';
import { LongVersion } from '../common/footer';
import pf_funding_svg from '../../public/pf_funding_logos.svg';
import { trimTrailingSlash } from '../utils/trim_trailing_slash';

export function AboutPage() {
  const routerBase = trimTrailingSlash(import.meta.env.BASE_URL);
  return (
    <AppCenter>
      <div className="prose dark:prose-invert">
        <h1>About transcribee 🐝</h1>
        <p>
          transcribee would not be possible without a large number of open source components. A list
          of all used components and their license can be found here:{' '}
          <a href={`${routerBase}/LICENSES.md`}>Open Acknowledgements</a>
        </p>
        <p>
          transcribee was funded from March until August 2023
          <img
            className="w-full"
            src={pf_funding_svg}
            alt='logos of the "Bundesministerium für Bildung und Forschung", Prototype Fund and OKFN-Deutschland'
          />
        </p>
        <p>
          transcribee is open source software. You can find the source code on{' '}
          <a href="https://github.com/bugbakery/transcribee">GitHub</a>
        </p>
        <div className="text-xs">
          <LongVersion />
        </div>
      </div>
    </AppCenter>
  );
}
