import { SubmitHandler, useForm } from 'react-hook-form';
import { useLocation } from 'wouter';
import { useState } from 'react';

import { storeAuthToken } from '../api';
import { login, useGetMe } from '../api/user';
import { Dialog, DialogTitle } from '../components/dialog';
import { FormControl, Input } from '../components/form';
import { PrimaryButton } from '../components/button';
import { AppCenter } from '../components/app';

type FieldValues = {
  username: string;
  password: string;
};

export function LoginPage() {
  const [_, navigate] = useLocation();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { mutate } = useGetMe({});

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FieldValues>();

  const submitHandler: SubmitHandler<FieldValues> = async (data) => {
    setErrorMessage(null); // clear general error when hitting submit

    try {
      const response = await login(data);
      storeAuthToken(response.data.token);
      mutate();
      navigate('/');
    } catch (e) {
      let message = 'An unknown error occcured.';

      if (e instanceof login.Error) {
        const error = e.getActualType();
        if (error.status === 422) {
          if (error.data.detail) {
            message = error.data.detail.map((x) => x.msg).join(' ');
          }
        } else if (error.status === 403) {
          message = 'Incorrect username or password.';
        }
      }

      setErrorMessage(message);
    }
  };

  return (
    <AppCenter>
      <Dialog>
        <DialogTitle>transcribee login</DialogTitle>
        <form
          onSubmit={handleSubmit(submitHandler, () => {
            setErrorMessage(null); // clear general error when hitting submit
          })}
        >
          <div className="flex flex-col gap-6">
            <FormControl label="Username" error={errors.username && 'This field is required.'}>
              <Input autoFocus {...register('username', { required: true })} />
            </FormControl>
            <FormControl label="Password" error={errors.password && 'This field is required.'}>
              <Input {...register('password', { required: true })} type="password" />
            </FormControl>

            {errorMessage && (
              <div className="block bg-red-100 px-2 py-2 rounded text-center text-red-700">
                {errorMessage}
              </div>
            )}
            <div className="block">
              <PrimaryButton type="submit">Login</PrimaryButton>
            </div>
          </div>
        </form>
      </Dialog>
    </AppCenter>
  );
}
