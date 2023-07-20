import { ComponentProps, useState } from 'react';
import { PrimaryButton } from './button';
import { FormControl, Input } from './form';
import { Modal } from './modal';
import { useForm, FieldValues, SubmitHandler } from 'react-hook-form';
import { changePassword } from '../api/user';

export function ChangePasswordModal({
  onClose,
  ...props
}: {
  onClose: () => void;
} & ComponentProps<typeof Modal>) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    getValues,
  } = useForm<FieldValues>();

  const submitHandler: SubmitHandler<FieldValues> = async (data) => {
    setErrorMessage(null); // clear general error when hitting submit

    try {
      await changePassword({
        new_password: data.new_password,
        old_password: data.old_password,
      });
      window.location.reload();
    } catch (e) {
      let message = 'An unknown error occcured.';

      if (e instanceof changePassword.Error) {
        const error = e.getActualType();
        console.log('error', e);
        if (error.status === 422) {
          if (error.data.detail) {
            message = error.data.detail.map((x) => x.msg).join(' ');
          }
        } else if (error.status === 403) {
          message = 'Incorrect old password.';
        }
      }

      setErrorMessage(message);
    }
  };

  return (
    <Modal {...props} onClose={onClose}>
      <form
        onSubmit={handleSubmit(submitHandler, () => {
          setErrorMessage(null); // clear general error when hitting submit
        })}
      >
        <div className="flex flex-col gap-6">
          <FormControl label="Old Password" error={errors.old_password?.message?.toString()}>
            <Input
              autoFocus
              {...register('old_password', { required: 'This field is required.' })}
              type="password"
            />
          </FormControl>
          <FormControl label="New Password" error={errors.new_password?.message?.toString()}>
            <Input
              {...register('new_password', {
                minLength: {
                  value: 6,
                  message: 'Password needs to be at least 6 characters long.',
                },
                required: 'This field is required.',
              })}
              type="password"
            />
          </FormControl>
          <FormControl
            label="New Password (again)"
            error={errors.confirm_new_password?.message?.toString()}
          >
            <Input
              {...register('confirm_new_password', {
                minLength: {
                  value: 6,
                  message: 'Password needs to be at least 6 characters long.',
                },
                required: 'This field is required',
                validate: (value) =>
                  value === getValues('new_password') || 'The new passwords must be the same',
              })}
              type="password"
            />
          </FormControl>

          {errorMessage && (
            <div className="block bg-red-100 px-2 py-2 rounded text-center text-red-700">
              {errorMessage}
            </div>
          )}
          <div className="block">
            <PrimaryButton type="submit">Change Password</PrimaryButton>
          </div>
        </div>
      </form>
    </Modal>
  );
}
