import { SubmitHandler, useForm } from 'react-hook-form';
import clsx from 'clsx';

import { BASE_URL } from '../api';

type FieldValues = {
  username: string;
  password: string;
};

export default function LoginPage() {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FieldValues>();
  const submitHandler: SubmitHandler<FieldValues> = async (data) => {
    await fetch(BASE_URL + 'v1/users/login/', {
      method: 'POST',
      body: JSON.stringify(data),
      headers: {
        'Content-Type': 'application/json',
      },
    });
  };

  return (
    <div
      className="h-screen w-screen flex items-center justify-center"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
    >
      <div className="w-96">
        <div className="p-6 bg-white border-black border-2 shadow-brutal rounded-lg">
          <h2 className="font-bold text-lg mb-4">Login</h2>
          <form onSubmit={handleSubmit(submitHandler)}>
            <div className="flex flex-col gap-6">
              <label className="block">
                <span className="text-sm font-medium">Username</span>
                <input
                  {...register('username', { required: true })}
                  className="block w-full form-input rounded border-2 border-black mt-0.5"
                />
                {errors.username && <p className="text-red-600">Username is required.</p>}
              </label>
              <label className="block">
                <span className="text-sm font-medium">Password</span>
                <input
                  {...register('password', { required: true })}
                  type="password"
                  className="block w-full form-input rounded border-2 border-black mt-0.5"
                />
                {errors.password && <p className="text-red-600">Password is required.</p>}
              </label>
              <div className="block">
                <button
                  type="submit"
                  className={clsx(
                    'bg-black',
                    'hover:bg-gray-700',
                    'rounded-md',
                    'text-white',
                    'py-2',
                    'px-4',
                  )}
                >
                  Login
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
