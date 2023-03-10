import { SubmitHandler, useForm } from 'react-hook-form';
import { navigate } from 'wouter/use-location';
import { useState } from 'react';

import { fetchApi, storeAuthToken } from '../api';
import Dialog from '../components/Dialog';
import DialogTitle from '../components/DialogTitle';
import Input from '../components/Input';
import PrimaryButton from '../components/PrimaryButton';
import FormControl from '../components/FormControl';

type FieldValues = {
  username: string;
  password: string;
};

export default function LoginPage() {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FieldValues>();

  const submitHandler: SubmitHandler<FieldValues> = async (data) => {
    setErrorMessage(null); // clear general error when hitting submit

    const response = await fetchApi('v1/users/login/', {
      method: 'POST',
      body: JSON.stringify(data),
    });

    if (response.ok) {
      const resData = await response.json();
      storeAuthToken(resData.token);
      navigate('/');
    } else {
      try {
        const resData = await response.json();
        setErrorMessage(resData.non_field_errors.join(' '));
      } catch (ex: unknown) {
        setErrorMessage('An unknown error occcured.');
      }
    }
  };

  return (
    <div className="h-screen w-screen flex items-center justify-center">
      <Dialog>
        <DialogTitle>Login</DialogTitle>
        <form
          onSubmit={handleSubmit(submitHandler, () => {
            setErrorMessage(null); // clear general error when hitting submit
          })}
        >
          <div className="flex flex-col gap-6">
            <FormControl label="Username" error={errors.username && 'This field is required.'}>
              <Input {...register('username', { required: true })} />
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
    </div>
  );
}
