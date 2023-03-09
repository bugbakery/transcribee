import { useForm } from 'react-hook-form';

export default function HomePage() {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm();

  return (
    <div className='h-screen w-screen flex items-center justify-center'>
    <div className="w-96">
      <div className="p-6 bg-white border-black border-2 shadow-brutal rounded-lg">
        <h2 className="font-bold text-lg mb-4">Create Document</h2>
        <form onSubmit={handleSubmit((data) => console.log(data))}>
          <div className="grid grid-cols-1 gap-6">
            <label className="block">
              <span className="text-sm font-medium">Name</span>
              <input
                {...register('name', { required: true })}
                className="block w-full form-input rounded border-2 border-black mt-0.5"
              />
              {errors.name && <p className="text-red-600">Name is required.</p>}
            </label>
            <label className="block">
              <span className="text-sm font-medium">Audio File</span>
              <input
                {...register('file', { required: true })}
                type="file"
                className="block w-full form-input rounded border-2 border-black mt-0.5 file:px-3 file:py-1 file:text-sm file:text-white file:mr-3 file:bg-black file:border-none  file:font-medium file:rounded-md file:hover:bg-gray-700"
              />
              {errors.file && <p className="text-red-600">File is required.</p>}
            </label>
            <div className="block">
              <button type="submit" className="bg-black rounded-lg text-white py-2 px-4">
                Create
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
    </div>
  );
}
