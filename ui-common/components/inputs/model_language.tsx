import { FormControl, Select } from '../form';
import { HelpPopup } from '../popup';
import languages from './languages.json';

export type ModelLanguage = keyof typeof languages;

export type ModelLanaguageInputProps = {
  error: string | undefined;
  value: ModelLanguage;
  onChange: (value: ModelLanguage) => void;
};

export function ModelLanguageInput({ error, value, onChange }: ModelLanaguageInputProps) {
  return (
    <FormControl label="Language" error={error}>
      <HelpPopup>
        <p className="pb-2">
          If you know the language of your document (and if only one language is spoken), you can
          set it here explicitly. Doing so might result in slightly better & faster transcriptions.
        </p>
        <p className="pb-2">It is also fine to leave this control on &lsquo;Auto Detect&rsquo;.</p>
      </HelpPopup>
      <div>
        <Select
          onChange={(e) => {
            onChange(e.currentTarget.value as ModelLanguage);
          }}
          value={value}
        >
          {Object.entries(languages).map(([lang, name]) => (
            <option value={lang} key={lang}>
              {name}
            </option>
          ))}
        </Select>
      </div>
    </FormControl>
  );
}
