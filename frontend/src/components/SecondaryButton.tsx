import { primitiveWithClassname } from '../styled';

const SecondaryButton = primitiveWithClassname('button', [
  'hover:bg-gray-200',
  'rounded-md',
  'py-2',
  'px-4',
]);

export default SecondaryButton;
