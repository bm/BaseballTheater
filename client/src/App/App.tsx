import { Grid } from '@material-ui/core';
import Container from '@material-ui/core/Container';
import Dialog from '@material-ui/core/Dialog';
import Drawer from '@material-ui/core/Drawer';
import React, { useEffect } from 'react';
import ReactGA from 'react-ga';
import Helmet from 'react-helmet';
import { RelayEnvironmentProvider } from 'react-relay';
import { useLocation } from 'react-router';

import { UpsellDataStore } from '../Areas/Game/Components/UpsellDataStore';
import { AuthDataStore } from '../Global/AuthDataStore';
import { Respond } from '../Global/Respond/Respond';
import { RespondSizes } from '../Global/Respond/RespondDataStore';
import { Upsell } from '../UI/Upsell';
import { useDataStore } from '../Utility/HookUtils';
import styles from './App.module.scss';
import { ErrorBoundary } from './ErrorBoundary';
import RelayEnvironment from './RelayEnvironment';
import { RouteContainer } from './Routes';
import Sidebar from './Sidebar';
import SidebarDrawer from './SidebarDrawer';
import { UpdateAvailableDialog } from './UpdateAvailableDialog';

//@ts-ignore

const App: React.FC = () => {
	const location = useLocation();

	const authContext = useDataStore(AuthDataStore);

	useEffect(() => {
		ReactGA.pageview(window.location.pathname + window.location.search);
	}, [location.pathname]);

	return (
		<RelayEnvironmentProvider environment={RelayEnvironment}>
			<Helmet defaultTitle={"Baseball Theater"} titleTemplate={"%s | Baseball Theater"} />
			<div className={styles.wrapper}>
				<nav className={styles.nav}>
					<Respond at={RespondSizes.medium}>
						<SidebarDrawer authContext={authContext} />
					</Respond>
					<Respond at={RespondSizes.medium} hide={true}>
						<Drawer anchor={"left"} variant={"persistent"} open={true} classes={{
							paper: styles.drawerPaper
						}}>
							<Sidebar authContext={authContext} />
						</Drawer>
					</Respond>
				</nav>
				<main className={styles.main}>
					<Container maxWidth={"xl"} style={{ position: "relative" }}>
						<Grid container>
							<ErrorBoundary>
								<RouteContainer />
							</ErrorBoundary>
						</Grid>
					</Container>
				</main>
				<UpdateAvailableDialog />
				<UpsellDialog />
			</div>
		</RelayEnvironmentProvider>
	);
}

const UpsellDialog: React.FC = () => {
	const upsellData = useDataStore(UpsellDataStore);

	return (
		<Dialog
			id="simple-menu"
			keepMounted
			classes={{
				paper: styles.dialog
			}}
			open={upsellData.backerType !== null}
			onClose={() => UpsellDataStore.close()}
		>
			<Upsell isModal={true} levelRequired={upsellData.backerType} onCancel={() => UpsellDataStore.close()} />
		</Dialog>
	);
}

export default App;
