interface BlanketReleaseDialogSetters {
  setOpen: (value: boolean) => void;
  setAmount: (value: string) => void;
  setDescription: (value: string) => void;
  setError: (value: string) => void;
}

export function resetBlanketReleaseDialog({
  setOpen,
  setAmount,
  setDescription,
  setError,
}: BlanketReleaseDialogSetters) {
  setOpen(false);
  setAmount('');
  setDescription('');
  setError('');
}

export function handleBlanketReleaseDialogOpenChange(
  open: boolean,
  setters: BlanketReleaseDialogSetters,
) {
  if (open) setters.setOpen(true);
  else resetBlanketReleaseDialog(setters);
}
