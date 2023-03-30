import { RouteComponentProps, useLocation } from 'wouter';
import { useGetDocument } from '../api/document';
import { IconButton } from '../components/IconButton';
import TranscriptionEditor from '../editor/TranscriptionEditor';
import { IoIosArrowBack } from 'react-icons/io';
import { MeButton, TopBar, TopBarPart, TopBarTitle } from '../common/TopBar';
import { AppContainer } from '../components/AppContainer';

export default function DocumentPage({ params }: RouteComponentProps<{ documentId: string }>) {
  const { data } = useGetDocument({ id: params.documentId });
  const [_location, navigate] = useLocation();

  return (
    <AppContainer>
      <TopBar>
        <TopBarPart className="sticky left-4 -ml-12">
          <IconButton icon={IoIosArrowBack} onClick={() => navigate('/')} />
          <TopBarTitle>{data?.name}</TopBarTitle>
        </TopBarPart>

        <TopBarPart>
          <MeButton />
        </TopBarPart>
      </TopBar>

      <TranscriptionEditor documentId={params.documentId} />
    </AppContainer>
  );
}
