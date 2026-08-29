import type { TNumericParamKey, TParamField } from "../../domain/generator/params";
import type { ChangeEvent, FC } from "react";

type TParamSliderProps = {
  field: TParamField;
  value: number;
  onChange: (key: TNumericParamKey, value: number) => void;
};

const formatValue = (value: number, step: number): string => {
  if (step >= 1) {
    return String(Math.round(value));
  }

  return value.toFixed(2);
};

const ParamSlider: FC<TParamSliderProps> = ({ field, value, onChange }) => {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(field.key, Number(event.target.value));
  };

  return (
    <label className="param" title={field.hint}>
      <span className="param__head">
        <span className="param__label">{field.label}</span>
        <span className="param__value">{formatValue(value, field.step)}</span>
      </span>
      <input
        type="range"
        min={field.min}
        max={field.max}
        step={field.step}
        value={value}
        onChange={handleChange}
      />
    </label>
  );
};

export { ParamSlider };
