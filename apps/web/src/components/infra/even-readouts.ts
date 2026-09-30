/// Class for `<Readouts>`: gives every readout's label row the same height, so
/// values line up whether or not a readout has a `delta` (the delta text is
/// taller than the mono label and would otherwise push that value down).
export const EVEN_READOUTS = "[&>*>div:first-child]:min-h-[18px]";
