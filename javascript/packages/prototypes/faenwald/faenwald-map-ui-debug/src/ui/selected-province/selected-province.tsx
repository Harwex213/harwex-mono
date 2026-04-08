import { memo } from "react";
import type { TProvince } from "@hw/faenwald-core";

type TSelectedProvinceProps = {
  province: TProvince;
};

const SelectedProvince = memo<TSelectedProvinceProps>(({ province }) => {

  return (
    <div>
    </div>
  )
});

export { SelectedProvince };
