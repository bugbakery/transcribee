import { primitiveWithClassname } from '../styled';

const PrimaryButton = primitiveWithClassname('button', [
  'bg-black',
  'hover:bg-gray-700',
  'rounded-md',
  'text-white',
  'py-2',
  'px-4',
]);

export default PrimaryButton;
